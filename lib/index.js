const fs = require('fs');
const path = require('path');
const cwd = (...args) => path.join(process.cwd(), ...args);
const branch = require('git-branch');
const chalk = require('chalk');
const dedent = require('dedent');
const gitP = require('simple-git/promise');
const inquirer = require('inquirer');
const git = gitP(process.cwd());

// emoji节选自这里，https://github.com/liuchengxu/git-commit-emoji-cn
const commitType = [
  {
    emoji: '✨',
    label: 'feat',
    description: '新功能',
  },
  {
    emoji: '🐛',
    label: 'fix',
    description: '修复bug',
  },
  {
    emoji: '🔨',
    label: 'refactor',
    description: '重构（即不是新增功能，也不是修改bug的代码变动）',
  },
  {
    emoji: '🔧',
    label: 'chore',
    description: '构建过程或辅助工具的变动',
  },
  {
    emoji: '📝',
    label: 'docs',
    description: '文档',
  },
  {
    emoji: '🎨',
    label: 'style',
    description: '格式（不影响代码运行的变动）',
  },
  {
    emoji: '✅',
    label: 'test',
    description: '增加测试',
  },
];

const commitEmojiMap = commitType.reduce((acc, cur) => {
  acc[cur.label] = cur.emoji + ' ';
  return acc;
}, {});

const hasFilesInWorkDir = (status) => {
  const { files = [] } = status;

  return files.some(v => {
    const { working_dir: workingDir = '' } = v;
    return workingDir.trim();
  });
};

const hasFilesInStage = (status) => {
  const { files = [] } = status;

  return files.some(v => {
    const { index = '' } = v;
    return index.trim();
  });
};

const warnLog = (text) => {
  return console.log(chalk.yellow(text));
}

const infoLog = (text) => {
  return console.log(chalk.cyan(text));
}

const successLog = (text) => {
  return console.log(chalk.green(text));
}

const errorLog = (text) => {
  return console.log(chalk.red(text));
}

const validateCommit = async () => {
  const status = await git.status();
  const workDirHasFile = hasFilesInWorkDir(status);
  const stageHasFile = hasFilesInStage(status);
  
  if (!workDirHasFile && !stageHasFile) {
    warnLog(`当前工作区以及暂存区均没有文件需要提交`);
    process.exit(1);
  }
  return {
    workDirHasFile,
    stageHasFile,
  };
};

// 判断是否有远程分支且是否需要拉取更新
const checkUpdatesOnRemote = async () => {
  const current = await branch();
  try {
    await git.fetch('origin', current);
  } catch (error) {
    return [error, null];
  }
  const diffSummary = await git.diffSummary([current, `origin/${current}`]);
  return [null, diffSummary.changed > 0];
};

const push = async () => {
  const current = await branch();
  await git.push('origin', current);
  successLog(`已提交代码`);
};

const update = async ({ tip = false } = {}) => {
  tip && infoLog(`正在更新代码`);
  const current = await branch();
  await git.stash();
  await git.pull('origin', current);
  const res = await git.stash(['pop']);
  if (res.indexOf('CONFLICT') > -1) {
    warnLog(`本地修改与远端存在冲突，请先解决冲突后再提交`);
    return [new Error(), null];
  }
  tip && successLog(`已更新代码`);
  return [null, null];
};

const pullUpdates = async ({ tip = false } = {}) => {
  const [, isBehind] = await checkUpdatesOnRemote();
  if (isBehind) {
    const [error] = await update({ tip });
    if (error) return [error, null];
  } else if (isBehind === false) {
    tip && successLog(`已更新代码`);
  }
  return [null, null];
};


const getCommitMsg = function(answer) {
  const commitEmoji = commitEmojiMap[answer.commitType];
  let commitMsg = `${answer.commitType}: ${commitEmoji}${answer.commitMsg}`;
  if (answer.commitDes) {
    commitMsg += `\n\n${answer.commitDes}`;
  }
  return commitMsg;
};

const commit = async ({ workDirHasFile, commitMsg, files = [] } = {}) => {
  if (workDirHasFile) {
    await git.add('.');
  }
  if (files.length) {
    await git.commit(dedent(commitMsg), files);
  } else {
    await git.commit(dedent(commitMsg));
  }
  successLog(`提交成功 ${commitMsg}`);
};

const getCommitAnswerChoice = function(arr) {
  const labelList = arr.map(v => v.label);
  const labelStrLenList = labelList.map(v => v.length);
  const maxLength = Math.max(...labelStrLenList);

  return arr.map(v => {
    const newLabel = v.label.padEnd(maxLength, ' ');
    const descriptionTip = `- ${newLabel} ${v.emoji || ''} ${v.description}`;
    return {
      name: descriptionTip,
      value: v.label,
    };
  });
};

const commitAnswers = [
  {
    name: 'commitType',
    message: '提交类型',
    type: 'list',
    default: 'feat',
    choices: getCommitAnswerChoice(commitType),
  },
  {
    name: 'commitMsg',
    message: '提交信息(标题)',
    validate: input => {
      input = input.trim();
      if (!input) return '必须填写提交信息';
      return true;
    },
    filter: input => input.trim(),
  },
  {
    name: 'commitDes',
    message: '提交描述（可忽略）',
    filter: input => input.trim(),
  },
];

feflow.cmd.register('commit', 'git 提交', async function(args) {
  // args 是 commit 后面的参数，已被 minimist 库解析
  // 例如 `fef commit readme.md package.json`，args 就是 { _: [readme.md, package.json] }，
  // 调用主要的逻辑
  // 判断是否git项目
  if (!fs.existsSync(cwd('./.git'))) return errorLog('当前项目不是git项目');

  // 检查是否需要 commit 或者 add
  const { workDirHasFile } = await validateCommit();
  
  // 需要push的话，先判断是否有远端分支，且本地是否落后于远端
  // 是则先暂存(git stash)本地修改，更新代码后再恢复 (git stash pop)

  const [error] = await pullUpdates();
  if (error) return;
  const answer = await inquirer.prompt(commitAnswers);
  const commitMsg = getCommitMsg(answer);
  
  await commit({
    workDirHasFile,
    commitMsg,
  });

  await push();
});
