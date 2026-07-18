import fs from 'fs';
import os from 'os';
import path from 'path';

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectRejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

function expectTruthy(value: unknown, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

export async function runTests(): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-db-'));
  process.env.DB_PATH = path.join(tempDir, 'tasks.db');

  const databaseService = (await import('../services/database.service')).default;

  try {
    const task = await databaseService.createTask({
      name: 'Stack Pivot Practice',
      category: 'pwn',
      requirement: 'Submit a working exploit writeup',
      threadId: 'thread-123',
      channelId: 'channel-123',
      roleId: 'role-123',
      createdBy: 'admin-123',
    });

    expectEqual(task.name, 'Stack Pivot Practice', 'task name should be persisted');
    expectEqual(task.category, 'pwn', 'task category should be persisted');
    expectEqual(task.revealed, false, 'new tasks should be unrevealed');

    await expectRejects(
      () =>
        databaseService.createTask({
          name: 'Duplicate Stack Pivot Practice',
          category: 'pwn',
          requirement: 'Submit another writeup',
          threadId: 'thread-123',
          channelId: 'channel-456',
          roleId: 'role-456',
          createdBy: 'admin-123',
        }),
      'duplicate thread IDs should be rejected'
    );

    await expectRejects(
      () =>
        databaseService.upsertTaskSubmission({
          taskId: task.id + 999,
          userId: 'orphan-user',
          username: 'orphan-user',
          content: 'orphaned solution',
        }),
      'submissions for missing task IDs should be rejected'
    );

    const orphanSubmissions = await databaseService.getTaskSubmissions(task.id + 999);
    expectEqual(orphanSubmissions.length, 0, 'orphan submissions should not persist');

    const firstSubmission = await databaseService.upsertTaskSubmission({
      taskId: task.id,
      userId: 'user-123',
      username: 'first-user',
      content: 'initial solution',
    });

    const secondSubmission = await databaseService.upsertTaskSubmission({
      taskId: task.id,
      userId: 'user-123',
      username: 'renamed-user',
      content: 'updated solution',
    });

    expectEqual(
      secondSubmission.id,
      firstSubmission.id,
      'upsert should update the same submission row'
    );
    expectEqual(
      secondSubmission.content,
      'updated solution',
      'upsert should return latest content'
    );

    const submissions = await databaseService.getTaskSubmissions(task.id);
    expectEqual(submissions.length, 1, 'task should have one latest submission');
    expectEqual(
      submissions[0]?.content,
      'updated solution',
      'latest submission content should be returned'
    );

    const history = await databaseService.getTaskSubmissionHistory(firstSubmission.id);
    expectEqual(history.length, 1, 'submission history should include the old content');
    expectEqual(history[0]?.content, 'initial solution', 'history should preserve old content');

    const revealedTask = await databaseService.revealTask(task.id);
    expectTruthy(revealedTask, 'revealed task should be returned');
    expectEqual(revealedTask?.revealed, true, 'revealTask should mark the task as revealed');
  } finally {
    databaseService.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests()
    .then(() => {
      console.log('task database tests passed');
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
