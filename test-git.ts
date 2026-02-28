import { spawn } from 'node:child_process';
const LOG_BATCH_FORMAT = '%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%ct%x1f%s%x1e';
async function main() {
  const mirrorPath = "/Users/mac/Desktop/code/grepbase/.cache/git-mirrors/b05b4163a112a892d90ccae3dffe3ef2b3e11c1c.git";
  const child = spawn('git', ['-C', mirrorPath, 'log', '--stdin', '--no-walk=unsorted', `--format=${LOG_BATCH_FORMAT}`]);
  child.stdout.setEncoding('utf8');
  let out = '';
  child.stdout.on('data', d => out += d);
  child.stdin.write("HEAD\nHEAD^\n");
  child.stdin.end();
  await new Promise(r => child.on('close', r));
  
  const records = out.split('\x1e');
  console.log('RECORDS LENGTH:', records.length);
  for (const record of records) {
      const cleaned = record.trim();
      if (!cleaned) continue;
      const parts = cleaned.split('\x1f');
      console.log(`Parts length: ${parts.length}`);
  }
}
main();
