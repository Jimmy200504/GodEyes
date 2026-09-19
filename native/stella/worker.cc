// Binary stdin / JSON stdout bridge. stella_vslam logs go to stderr.
#include "stella_vslam/system.h"
#include "stella_vslam/config.h"
#include "stella_vslam/publish/frame_publisher.h"
#include "stella_vslam/publish/map_publisher.h"
#include "stella_vslam/data/landmark.h"
#include <memory>
#include <set>
#include <cstdint>
#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <unistd.h>

static uint64_t big_endian(const unsigned char* p, int n) {
    uint64_t value = 0;
    for (int i = 0; i < n; ++i) value = (value << 8) | p[i];
    return value;
}

int main(int argc, char** argv) {
    if (argc != 3) {
        std::cerr << "usage: godeyes_stella_worker vocabulary.fbow camera.yaml\n";
        return 2;
    }
    // Redirect at the file descriptor level: upstream printf and cout must never
    // corrupt the wire protocol. Keep the original stdout for our replies only.
    const int output_fd = dup(STDOUT_FILENO);
    if (output_fd < 0 || dup2(STDERR_FILENO, STDOUT_FILENO) < 0) return 2;
    FILE* output = fdopen(output_fd, "w");
    if (!output) return 2;
    setvbuf(output, nullptr, _IOLBF, 0);
    try {
        cv::setNumThreads(2);
        auto config = std::make_shared<stella_vslam::config>(argv[2]);
        stella_vslam::system slam(config, argv[1]);
        slam.startup();
        uint64_t epoch = 0;
        bool had_tracking = false;
        fprintf(output, "{\"ready\":true,\"protocol\":1}\n");
        uint64_t previous_ns = 0;
        bool have_previous = false;
        while (true) {
            unsigned char header[16];
            std::cin.read(reinterpret_cast<char*>(header), sizeof(header));
            if (std::cin.gcount() == 0 && std::cin.eof()) break;
            if (std::cin.gcount() != sizeof(header)) throw std::runtime_error("truncated header");
            const auto flags = big_endian(header, 4);
            const auto size = big_endian(header + 4, 4);
            const auto ns = big_endian(header + 8, 8);
            if (flags > 1 || size != 640 * 480 || ns >= (uint64_t(1) << 53))
                throw std::runtime_error("invalid frame header");
            if (!flags && have_previous && ns <= previous_ns)
                throw std::runtime_error("non-increasing capture timestamp");
            cv::Mat gray(480, 640, CV_8UC1);
            std::cin.read(reinterpret_cast<char*>(gray.data), size);
            if (std::cin.gcount() != static_cast<std::streamsize>(size))
                throw std::runtime_error("truncated image");
            if (flags) {
                slam.request_reset();
                ++epoch;
                had_tracking = false;
            }
            previous_ns = ns;
            have_previous = true;
            // stella returns camera-to-world, unlike ORB-SLAM3 TrackMonocular.
            const auto Twc = slam.feed_monocular_frame(gray, double(ns) / 1e9);
            const auto publisher = slam.get_frame_publisher();
            const auto state = publisher->get_tracking_state();
            if (state == "Initializing" && had_tracking) {
                ++epoch;  // Upstream can reset after early tracking failure.
                had_tracking = false;
            }
            if (state == "Tracking") had_tracking = true;
            size_t tracked = 0;
            for (const auto& point : publisher->get_landmarks())
                if (point && !point->will_be_erased()) ++tracked;
            std::vector<std::shared_ptr<stella_vslam::data::landmark>> landmarks;
            std::set<std::shared_ptr<stella_vslam::data::landmark>> local_landmarks;
            const auto count = slam.get_map_publisher()->get_landmarks(landmarks, local_landmarks);
            const bool valid = state == "Tracking" && Twc && Twc->allFinite();
            fprintf(output, "{\"state\":\"%s\",\"map_id\":%llu,\"map_points\":%u,"
                    "\"tracked_points\":%zu,\"capture_ns\":%llu,",
                    state.c_str(), static_cast<unsigned long long>(epoch), count, tracked,
                    static_cast<unsigned long long>(ns));
            if (valid) {
                const auto t = Twc->block<3, 1>(0, 3).eval();
                const Eigen::Quaterniond q(Twc->block<3, 3>(0, 0));
                fprintf(output, "\"position\":[%.9g,%.9g,%.9g],\"quaternion_xyzw\":[%.9g,%.9g,%.9g,%.9g]}\n",
                        double(t.x()), double(t.y()), double(t.z()),
                        double(q.x()), double(q.y()), double(q.z()), double(q.w()));
            } else {
                fprintf(output, "\"position\":null,\"quaternion_xyzw\":null}\n");
            }
        }
        slam.shutdown();
        fclose(output);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "stella worker failed: " << error.what() << '\n';
        return 1;
    }
}
