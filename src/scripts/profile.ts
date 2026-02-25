import { performance } from 'perf_hooks';

async function run() {
    console.log('Starting fetch profile...');
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
        await fetch('http://localhost:3000/api/repos/20/commits', {
            headers: { 'Cookie': 'session=mock' }
        });
    }
    const duration = performance.now() - start;
    console.log(`Finished 50 requests in ${duration.toFixed(2)}ms`);
    console.log(`Average: ${(duration / 50).toFixed(2)}ms per request`);
    process.exit(0);
}

run();
