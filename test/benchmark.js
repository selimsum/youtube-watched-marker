const { performance } = require('perf_hooks');

// Generate mock queue
const queueSize = 100000;
const queue = [];
const statuses = ["pending", "running", "completed", "failed"];
for (let i = 0; i < queueSize; i++) {
  queue.push({
    status: statuses[i % statuses.length],
    videoId: `video_${i}`
  });
}

function original() {
  return new Set(queue
    .filter((item) => ["pending", "running"].includes(item.status))
    .map((item) => item.videoId));
}

function optimized() {
  const activeVideoIds = new Set();
  for (const item of queue) {
    if (item.status === "pending" || item.status === "running") {
      activeVideoIds.add(item.videoId);
    }
  }
  return activeVideoIds;
}

function runBenchmark(name, fn) {
  // warm up
  for (let i=0; i<10; i++) fn();

  const start = performance.now();
  for (let i=0; i<100; i++) fn();
  const end = performance.now();

  console.log(`${name}: ${(end - start).toFixed(2)} ms`);
  return end - start;
}

const origTime = runBenchmark("Original", original);
const optTime = runBenchmark("Optimized", optimized);

console.log(`Improvement: ${((origTime - optTime) / origTime * 100).toFixed(2)}%`);
