export class TaskPool {
  constructor({ concurrency = 4, maxQueue = 1000, name = "task" } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new TypeError("concurrency must be a positive integer");
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new TypeError("maxQueue must be a non-negative integer");
    }
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.name = name;
    this.active = 0;
    this.queue = [];
  }

  get stats() {
    return {
      active: this.active,
      queued: this.queue.length,
      concurrency: this.concurrency,
      maxQueue: this.maxQueue,
    };
  }

  run(task) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("task must be a function"));
    }

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject };
      if (this.active < this.concurrency) {
        this.#start(entry);
        return;
      }

      if (this.queue.length >= this.maxQueue) {
        const error = new Error(`${this.name} queue is full`);
        error.code = "QUEUE_FULL";
        error.statusCode = 503;
        error.publicMessage = "Refresh queue is temporarily full";
        reject(error);
        return;
      }

      this.queue.push(entry);
    });
  }

  #start(entry) {
    this.active += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active -= 1;
        this.#drain();
      });
  }

  #drain() {
    while (this.active < this.concurrency && this.queue.length) {
      this.#start(this.queue.shift());
    }
  }
}
