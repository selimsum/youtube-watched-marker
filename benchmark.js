const assert = require('assert');

function getActiveQueueCountOld(queue) {
  return queue.filter((item) => ["pending", "running"].includes(item.status)).length;
}

function getActiveQueueCountNew(queue) {
  let count = 0;
  for (let i = 0; i < queue.length; i++) {
    const status = queue[i].status;
    if (status === "pending" || status === "running") {
      count++;
    }
  }
  return count;
}

// Generate a large queue
const queue = [];
const statuses = ["pending", "running", "completed", "failed", "paused"];
for (let i = 0; i < 100000; i++) {
  queue.push({ status: statuses[i % statuses.length] });
}

// Verify correctness
assert.strictEqual(getActiveQueueCountOld(queue), getActiveQueueCountNew(queue));

const iterations = 1000;

console.log('Warming up...');
for (let i = 0; i < 100; i++) {
  getActiveQueueCountOld(queue);
  getActiveQueueCountNew(queue);
}

console.log('Benchmarking Old...');
const startOld = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  getActiveQueueCountOld(queue);
}
const endOld = process.hrtime.bigint();
const timeOld = Number(endOld - startOld) / 1e6; // ms

console.log('Benchmarking New...');
const startNew = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
  getActiveQueueCountNew(queue);
}
const endNew = process.hrtime.bigint();
const timeNew = Number(endNew - startNew) / 1e6; // ms

console.log(`Old time: ${timeOld.toFixed(2)} ms`);
console.log(`New time: ${timeNew.toFixed(2)} ms`);
console.log(`Improvement: ${((timeOld - timeNew) / timeOld * 100).toFixed(2)}%`);
