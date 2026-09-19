"""Record TFLite I/O metadata without invoking models or claiming NPU performance."""
from pathlib import Path
import hashlib
import json
import tflite_runtime.interpreter as tflite

root = Path(__file__).resolve().parent
rows = []
for path in sorted((root / 'models').rglob('*.tflite')):
    data = path.read_bytes()
    if data[4:8] != b'TFL3':
        raise ValueError(f'Invalid TFLite header: {path}')
    interpreter = tflite.Interpreter(model_path=str(path))
    def details(items):
        return [dict(name=x['name'], shape=x['shape'].tolist(), dtype=x['dtype'].__name__,
                     quantization=list(x['quantization'])) for x in items]
    rows.append(dict(path=str(path.relative_to(root)), bytes=len(data),
                     sha256=hashlib.sha256(data).hexdigest(),
                     inputs=details(interpreter.get_input_details()),
                     outputs=details(interpreter.get_output_details())))
(root / 'inventory.json').write_text(json.dumps(rows, indent=2) + '\n')
for row in rows:
    print(row['path'], row['bytes'], row['inputs'])
