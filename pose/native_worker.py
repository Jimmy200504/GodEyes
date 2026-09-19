"""Bounded binary frame / JSON subprocess transport for native SLAM engines."""
import json
import os
import select
import struct
import subprocess
import time

import numpy as np


class Worker:
    """One request in flight, bounded I/O; a stuck native worker fails explicitly."""
    def __init__(self, command, startup_timeout=180, label="SLAM"):
        self.label = label
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        bufsize=0)
        self.buffer = b''
        os.set_blocking(self.process.stdin.fileno(), False)
        os.set_blocking(self.process.stdout.fileno(), False)
        try:
            if self.read_reply(time.monotonic() + startup_timeout) != {'ready': True, 'protocol': 1}:
                raise RuntimeError(f'Unexpected {self.label} worker handshake')
        except BaseException:
            self.close()
            raise

    def read_reply(self, deadline):
        while b'\n' not in self.buffer:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.process.stdout], [], [], remaining)[0]:
                raise RuntimeError(f'{self.label} worker timed out; see terminal logs')
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError(f'{self.label} worker exited; see terminal logs')
            self.buffer += chunk
            if len(self.buffer) > 65536:
                raise RuntimeError(f'Oversized {self.label} reply')
        line, self.buffer = self.buffer.split(b'\n', 1)
        try:
            return json.loads(line)
        except (ValueError, UnicodeError) as error:
            raise RuntimeError(f'Invalid {self.label} reply') from error

    def track(self, gray, capture_ns, reset=False, timeout=10):
        if gray.shape != (480, 640) or gray.dtype != np.uint8:
            raise ValueError(f'{self.label} expects rectified uint8 640x480 grayscale')
        data = memoryview(struct.pack('!IIQ', int(reset), gray.size, capture_ns) + gray.tobytes())
        deadline = time.monotonic() + timeout
        try:
            while data:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([], [self.process.stdin], [], remaining)[1]:
                    raise RuntimeError(f'{self.label} worker input timed out')
                count = os.write(self.process.stdin.fileno(), data[:65536])
                data = data[count:]
            reply = self.read_reply(deadline)
            if not isinstance(reply, dict) or reply.get('capture_ns') != capture_ns:
                raise RuntimeError(f'{self.label} response does not match the input frame')
            return reply
        except OSError as error:
            raise RuntimeError(f'{self.label} worker disconnected') from error

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)
        self.process.stdout.close()

