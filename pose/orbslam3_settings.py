"""OpenCV settings for already rectified 640x480 grayscale input."""
def camera_settings(K, features=1200):
    # Input has already been rectified by SlamFrameProcessor. Do not apply the
    # original distortion again in ORB-SLAM3.
    values = {
        'Camera1.fx': float(K[0, 0]), 'Camera1.fy': float(K[1, 1]),
        'Camera1.cx': float(K[0, 2]), 'Camera1.cy': float(K[1, 2]),
        'Camera1.k1': 0.0, 'Camera1.k2': 0.0, 'Camera1.p1': 0.0,
        'Camera1.p2': 0.0, 'Camera1.k3': 0.0,
        'Camera.width': 640, 'Camera.height': 480, 'Camera.fps': 30,
        'Camera.RGB': 0, 'ORBextractor.nFeatures': features,
        'ORBextractor.scaleFactor': 1.2, 'ORBextractor.nLevels': 8,
        'ORBextractor.iniThFAST': 20, 'ORBextractor.minThFAST': 7,
        'Viewer.KeyFrameSize': .05, 'Viewer.KeyFrameLineWidth': 1.0,
        'Viewer.GraphLineWidth': .9, 'Viewer.PointSize': 2.0,
        'Viewer.CameraSize': .08, 'Viewer.CameraLineWidth': 3.0,
        'Viewer.ViewpointX': 0.0, 'Viewer.ViewpointY': -.7,
        'Viewer.ViewpointZ': -1.8, 'Viewer.ViewpointF': 500.0,
    }
    return '%YAML:1.0\nFile.version: "1.0"\nCamera.type: "PinHole"\n' + ''.join(
        f'{key}: {value}\n' for key, value in values.items())

