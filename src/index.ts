import { loadConfig, redact } from './config.js';
import { Watcher } from './watcher.js';

function main(): void {
  const cfg = loadConfig();

  console.log('=== Jira-Kiro Watcher ===');
  console.log(`Jira      : ${cfg.jira.baseUrl} (auth=${cfg.jira.authType}, token=${redact(cfg.jira.token)})`);
  console.log(`Watch     : ${cfg.watch.jql}`);
  console.log(`Trigger   : "${cfg.watch.triggerStatus}" setiap ${cfg.watch.pollIntervalSeconds}s`);
  console.log(`Repo      : ${cfg.target.repoPath}`);
  console.log(`Output    : ${cfg.target.taskOutputDir}/<SUBTASK-KEY>.md`);
  console.log('=========================');

  const watcher = new Watcher(cfg);
  watcher.start();

  const shutdown = () => {
    watcher.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
