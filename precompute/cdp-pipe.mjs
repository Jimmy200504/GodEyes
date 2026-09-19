// Chrome's remote-debugging-pipe uses NUL-terminated JSON on child fds 3/4.
export class CdpPipe {
  constructor(child) {
    this.child = child; this.id = 0; this.pending = new Map(); this.buffer = ''; this.closed = false;
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', chunk => {
      this.buffer += chunk;
      let end;
      while ((end = this.buffer.indexOf('\0')) >= 0) {
        const json = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!json) continue;
        try {
          const message = JSON.parse(json), task = this.pending.get(message.id);
          if (!task) continue;
          clearTimeout(task.timer); this.pending.delete(message.id);
          if (message.error) task.reject(new Error(message.error.message));
          else task.resolve(message.result);
        } catch (error) { this.close(error); }
      }
    });
    child.on('error', error => this.close(error));
    child.on('exit', () => this.close(new Error('Chrome exited before the export finished')));
    child.stdio[3].on('error', error => this.close(error));
    child.stdio[4].on('error', error => this.close(error));
  }
  send(method, params = {}, sessionId, timeout = 60000) {
    if (this.closed) return Promise.reject(new Error('Chrome connection closed'));
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    });
  }
  close(error = new Error('Chrome connection closed')) {
    this.closed = true;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
    this.pending.clear();
  }
}
