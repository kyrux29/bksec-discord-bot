import { spawn } from 'child_process';

const args = process.argv.slice(2);
const runTestsByPathIndex = args.indexOf('--runTestsByPath');
const testFiles =
  runTestsByPathIndex >= 0
    ? args.slice(runTestsByPathIndex + 1).filter((arg) => !arg.startsWith('--'))
    : ['src/tests/ctftime.test.ts', 'src/tests/task-database.test.ts', 'src/tests/ctf-visibility.test.ts'];

if (testFiles.length === 0) {
  throw new Error('--runTestsByPath requires at least one test path');
}

async function runTestFile(testFile: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', testFile], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${testFile} failed with exit code ${code}`));
    });
  });
}

async function run(): Promise<void> {
  for (const testFile of testFiles) {
    await runTestFile(testFile);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
