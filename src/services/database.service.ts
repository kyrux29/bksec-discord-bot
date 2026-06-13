import Database from 'better-sqlite3';
import path from 'path';
import {
  ClubTask,
  CTFData,
  TaskCategory,
  TaskSubmission,
  TaskSubmissionHistory,
  TaskWithSubmissions,
} from '../types';
import logger from '../utils/logger';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'ctf.db');

/**
 * Database service for managing CTF data using SQLite3
 */
class DatabaseService {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('foreign_keys = ON');
    this.ensureDatabase();
  }

  /**
   * Initialize database schema if not exists
   */
  ensureDatabase(): void {
    try {
      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ctfs (
          id INTEGER PRIMARY KEY,
          ctftimeid INTEGER NOT NULL,
          role TEXT NOT NULL,
          cate TEXT NOT NULL,
          name TEXT NOT NULL,
          infom TEXT NOT NULL,
          channel TEXT NOT NULL,
          endtime INTEGER NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ctftimeid ON ctfs(ctftimeid);
        CREATE INDEX IF NOT EXISTS idx_cate ON ctfs(cate);
        CREATE INDEX IF NOT EXISTS idx_archived ON ctfs(archived);
        CREATE INDEX IF NOT EXISTS idx_endtime ON ctfs(endtime);

        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN ('pwn','rev','crypto','all')),
          requirement TEXT NOT NULL,
          thread_id TEXT NOT NULL UNIQUE,
          channel_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          created_by TEXT NOT NULL,
          revealed INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS task_submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          updated_at INTEGER DEFAULT (strftime('%s','now')),
          UNIQUE(task_id,user_id),
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS task_submission_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          submission_id INTEGER NOT NULL,
          task_id INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s','now')),
          FOREIGN KEY(submission_id) REFERENCES task_submissions(id) ON DELETE CASCADE,
          FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
        CREATE INDEX IF NOT EXISTS idx_tasks_revealed ON tasks(revealed);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_thread_id_unique ON tasks(thread_id);
        CREATE INDEX IF NOT EXISTS idx_task_submissions_task_id ON task_submissions(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_submission_history_submission_id ON task_submission_history(submission_id);
      `);

      // Migrate: add channels_purged column if not present
      try {
        this.db.exec('ALTER TABLE ctfs ADD COLUMN channels_purged INTEGER NOT NULL DEFAULT 0');
      } catch {
        // column already exists
      }

      // Initialize counter if not exists
      const counter = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('counter');
      if (!counter) {
        this.db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('counter', 0);
        logger.info('Database initialized with counter = 0');
      }

      logger.debug('Database schema ensured');
    } catch (error) {
      logger.error('Failed to ensure database schema:', error);
      throw new Error('Database initialization error');
    }
  }

  /**
   * Find CTF by CTFtime ID
   */
  async findByCTFTimeId(ctftimeId: number): Promise<{ key: string; data: CTFData } | null> {
    try {
      const row = this.db
        .prepare('SELECT * FROM ctfs WHERE ctftimeid = ?')
        .get(ctftimeId) as any;

      if (!row) return null;

      return {
        key: row.id.toString(),
        data: this.rowToCTFData(row),
      };
    } catch (error) {
      logger.error('Failed to find CTF by CTFtime ID:', error);
      return null;
    }
  }

  /**
   * Find CTF by Discord role ID
   */
  async findByRoleId(roleId: string): Promise<{ key: string; data: CTFData } | null> {
    try {
      const row = this.db.prepare('SELECT * FROM ctfs WHERE role = ?').get(roleId) as any;
      if (!row) return null;
      return { key: row.id.toString(), data: this.rowToCTFData(row) };
    } catch (error) {
      logger.error('Failed to find CTF by role ID:', error);
      return null;
    }
  }

  /**
   * Find CTF by category ID
   */
  async findByCategoryId(categoryId: string): Promise<{ key: string; data: CTFData } | null> {
    try {
      const row = this.db.prepare('SELECT * FROM ctfs WHERE cate = ?').get(categoryId) as any;

      if (!row) return null;

      return {
        key: row.id.toString(),
        data: this.rowToCTFData(row),
      };
    } catch (error) {
      logger.error('Failed to find CTF by category ID:', error);
      return null;
    }
  }

  /**
   * Add new CTF to database
   */
  async addCTF(ctfData: Omit<CTFData, 'archived' | 'channelsPurged'>): Promise<number> {
    try {
      // Get and increment counter
      const counter = this.db
        .prepare('SELECT value FROM metadata WHERE key = ?')
        .get('counter') as { value: number };
      const newId = counter.value + 1;

      // Update counter
      this.db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(newId, 'counter');

      // Insert CTF
      this.db
        .prepare(
          `INSERT INTO ctfs (id, ctftimeid, role, cate, name, infom, channel, endtime, archived)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId,
          ctfData.ctftimeid,
          ctfData.role.toString(),
          ctfData.cate.toString(),
          ctfData.name,
          ctfData.infom.toString(),
          ctfData.channel.toString(),
          ctfData.endtime,
          0
        );

      logger.info(`CTF added to database: ${ctfData.name} (ID: ${newId})`);
      return newId;
    } catch (error) {
      logger.error('Failed to add CTF:', error);
      throw new Error('Database write error');
    }
  }

  /**
   * Update CTF data
   */
  async updateCTF(key: string, updates: Partial<CTFData>): Promise<void> {
    try {
      const id = parseInt(key);
      const setClauses: string[] = [];
      const values: any[] = [];

      if (updates.ctftimeid !== undefined) {
        setClauses.push('ctftimeid = ?');
        values.push(updates.ctftimeid);
      }
      if (updates.role !== undefined) {
        setClauses.push('role = ?');
        values.push(updates.role.toString());
      }
      if (updates.cate !== undefined) {
        setClauses.push('cate = ?');
        values.push(updates.cate.toString());
      }
      if (updates.name !== undefined) {
        setClauses.push('name = ?');
        values.push(updates.name);
      }
      if (updates.infom !== undefined) {
        setClauses.push('infom = ?');
        values.push(updates.infom.toString());
      }
      if (updates.channel !== undefined) {
        setClauses.push('channel = ?');
        values.push(updates.channel.toString());
      }
      if (updates.endtime !== undefined) {
        setClauses.push('endtime = ?');
        values.push(updates.endtime);
      }
      if (updates.archived !== undefined) {
        setClauses.push('archived = ?');
        values.push(updates.archived ? 1 : 0);
      }
      if (updates.channelsPurged !== undefined) {
        setClauses.push('channels_purged = ?');
        values.push(updates.channelsPurged ? 1 : 0);
      }

      setClauses.push("updated_at = strftime('%s', 'now')");
      values.push(id);

      const sql = `UPDATE ctfs SET ${setClauses.join(', ')} WHERE id = ?`;
      const result = this.db.prepare(sql).run(...values);

      if (result.changes === 0) {
        throw new Error(`CTF with key ${key} not found`);
      }

      logger.info(`CTF updated in database: ${key}`);
    } catch (error) {
      logger.error('Failed to update CTF:', error);
      throw error;
    }
  }

  /**
   * Delete CTF from database
   */
  async deleteCTF(key: string): Promise<CTFData> {
    try {
      const id = parseInt(key);

      // Get the CTF data before deleting
      const row = this.db.prepare('SELECT * FROM ctfs WHERE id = ?').get(id) as any;

      if (!row) {
        throw new Error(`CTF with key ${key} not found`);
      }

      // Delete the CTF
      this.db.prepare('DELETE FROM ctfs WHERE id = ?').run(id);

      const deletedData = this.rowToCTFData(row);
      logger.info(`CTF deleted from database: ${deletedData.name}`);

      return deletedData;
    } catch (error) {
      logger.error('Failed to delete CTF:', error);
      throw error;
    }
  }

  /**
   * Get all CTFs sorted by index
   */
  async getAllCTFs(
    order: 'oldest' | 'newest' = 'newest'
  ): Promise<Array<{ key: string; data: CTFData }>> {
    try {
      const orderBy = order === 'newest' ? 'DESC' : 'ASC';
      const rows = this.db.prepare(`SELECT * FROM ctfs ORDER BY id ${orderBy}`).all() as any[];

      return rows.map((row) => ({
        key: row.id.toString(),
        data: this.rowToCTFData(row),
      }));
    } catch (error) {
      logger.error('Failed to get all CTFs:', error);
      return [];
    }
  }

  /**
   * Get archived CTFs that need to be hidden
   */
  async getExpiredCTFs(currentTime: number): Promise<Array<{ key: string; data: CTFData }>> {
    try {
      const rows = this.db
        .prepare('SELECT * FROM ctfs WHERE archived = 0 AND endtime < ?')
        .all(currentTime) as any[];

      return rows.map((row) => ({
        key: row.id.toString(),
        data: this.rowToCTFData(row),
      }));
    } catch (error) {
      logger.error('Failed to get expired CTFs:', error);
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalCTFs: number;
    archivedCTFs: number;
    activeCTFs: number;
    counter: number;
  }> {
    try {
      const total = this.db.prepare('SELECT COUNT(*) as count FROM ctfs').get() as {
        count: number;
      };
      const archived = this.db.prepare('SELECT COUNT(*) as count FROM ctfs WHERE archived = 1').get() as {
        count: number;
      };
      const counter = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('counter') as {
        value: number;
      };

      return {
        totalCTFs: total.count,
        archivedCTFs: archived.count,
        activeCTFs: total.count - archived.count,
        counter: counter.value,
      };
    } catch (error) {
      logger.error('Failed to get database stats:', error);
      return { totalCTFs: 0, archivedCTFs: 0, activeCTFs: 0, counter: 0 };
    }
  }

  async markAsPurged(key: string): Promise<void> {
    const id = parseInt(key);
    this.db
      .prepare("UPDATE ctfs SET channels_purged = 1, updated_at = strftime('%s', 'now') WHERE id = ?")
      .run(id);
    logger.info(`CTF marked as purged: ${key}`);
  }

  async createTask(input: {
    name: string;
    category: TaskCategory;
    requirement: string;
    threadId: string;
    channelId: string;
    roleId: string;
    createdBy: string;
  }): Promise<ClubTask> {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO tasks (name, category, requirement, thread_id, channel_id, role_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name,
          input.category,
          input.requirement,
          input.threadId,
          input.channelId,
          input.roleId,
          input.createdBy
        );
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid) as any;
      if (!row) throw new Error('Inserted task not found');
      logger.info(`Task added to database: ${input.name} (ID: ${result.lastInsertRowid})`);
      return this.rowToTask(row);
    } catch (error) {
      logger.error('Failed to create task:', error);
      throw new Error('Database write error');
    }
  }

  async getTask(taskId: number): Promise<ClubTask | null> {
    try {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
      return row ? this.rowToTask(row) : null;
    } catch (error) {
      logger.error('Failed to get task:', error);
      return null;
    }
  }

  async getAllTasks(): Promise<ClubTask[]> {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, id DESC').all() as any[];
    return rows.map((row) => this.rowToTask(row));
  }

  async getUnrevealedTasks(): Promise<ClubTask[]> {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE revealed = 0 ORDER BY created_at DESC, id DESC')
      .all() as any[];
    return rows.map((row) => this.rowToTask(row));
  }

  async getRevealedTasks(): Promise<ClubTask[]> {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE revealed = 1 ORDER BY created_at DESC, id DESC')
      .all() as any[];
    return rows.map((row) => this.rowToTask(row));
  }

  async upsertTaskSubmission(input: {
    taskId: number;
    userId: string;
    username: string;
    content: string;
  }): Promise<TaskSubmission> {
    try {
      const upsertSubmission = this.db.transaction(() => {
        const existing = this.db
          .prepare('SELECT * FROM task_submissions WHERE task_id = ? AND user_id = ?')
          .get(input.taskId, input.userId) as any;

        if (existing) {
          this.db
            .prepare(
              `INSERT INTO task_submission_history (submission_id, task_id, user_id, username, content)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(existing.id, existing.task_id, existing.user_id, existing.username, existing.content);

          this.db
            .prepare(
              `UPDATE task_submissions
               SET username = ?, content = ?, updated_at = strftime('%s', 'now')
               WHERE id = ?`
            )
            .run(input.username, input.content, existing.id);

          return this.db.prepare('SELECT * FROM task_submissions WHERE id = ?').get(existing.id) as any;
        }

        const result = this.db
          .prepare(
            `INSERT INTO task_submissions (task_id, user_id, username, content)
             VALUES (?, ?, ?, ?)`
          )
          .run(input.taskId, input.userId, input.username, input.content);

        return this.db.prepare('SELECT * FROM task_submissions WHERE id = ?').get(result.lastInsertRowid) as any;
      });

      const row = upsertSubmission();
      if (!row) throw new Error('Inserted submission not found');
      return this.rowToTaskSubmission(row);
    } catch (error) {
      logger.error('Failed to upsert task submission:', error);
      throw new Error('Database write error');
    }
  }

  async getTaskSubmissions(taskId: number): Promise<TaskSubmission[]> {
    const rows = this.db
      .prepare('SELECT * FROM task_submissions WHERE task_id = ? ORDER BY updated_at DESC, id DESC')
      .all(taskId) as any[];
    return rows.map((row) => this.rowToTaskSubmission(row));
  }

  async getTaskSubmissionHistory(submissionId: number): Promise<TaskSubmissionHistory[]> {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM task_submission_history
         WHERE submission_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(submissionId) as any[];
    return rows.map((row) => this.rowToTaskSubmissionHistory(row));
  }

  async revealTask(taskId: number): Promise<ClubTask | null> {
    try {
      this.db
        .prepare("UPDATE tasks SET revealed = 1, updated_at = strftime('%s', 'now') WHERE id = ?")
        .run(taskId);
      return this.getTask(taskId);
    } catch (error) {
      logger.error('Failed to reveal task:', error);
      throw new Error('Database write error');
    }
  }

  async getTasksWithSubmissions(): Promise<TaskWithSubmissions[]> {
    const tasks = await this.getAllTasks();
    const tasksWithSubmissions: TaskWithSubmissions[] = [];
    for (const task of tasks) {
      tasksWithSubmissions.push({ ...task, submissions: await this.getTaskSubmissions(task.id) });
    }
    return tasksWithSubmissions;
  }

  private rowToTask(row: any): ClubTask {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      requirement: row.requirement,
      threadId: row.thread_id,
      channelId: row.channel_id,
      roleId: row.role_id,
      createdBy: row.created_by,
      revealed: row.revealed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToTaskSubmission(row: any): TaskSubmission {
    return {
      id: row.id,
      taskId: row.task_id,
      userId: row.user_id,
      username: row.username,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToTaskSubmissionHistory(row: any): TaskSubmissionHistory {
    return {
      id: row.id,
      submissionId: row.submission_id,
      taskId: row.task_id,
      userId: row.user_id,
      username: row.username,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  /**
   * Convert database row to CTFData
   */
  private rowToCTFData(row: any): CTFData {
    return {
      ctftimeid: row.ctftimeid,
      role: row.role,
      cate: row.cate,
      name: row.name,
      infom: row.infom,
      channel: row.channel,
      endtime: row.endtime,
      archived: row.archived === 1,
      channelsPurged: row.channels_purged === 1,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

export default new DatabaseService();
