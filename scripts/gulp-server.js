'use strict';
/*
 * How to run gulp programatically and get logs.
 * https://github.com/gulpjs/gulp/issues/770
 *
 * But this is good when running a single gulpfile.  We might need to run
 * different ones, so we need some level of isolation.
 *
 */
const argv = require('argv');
const byline = require('byline');
const net = require('net');
const spawn = require('child_process').spawn;
const prettyTime = require('pretty-time');
const uncolor = require('uncolor');
const vm = require('vm');
const path = require('path');

const gulpMsg = /^\[[0-9:]+\] (Starting|Finished) /

/*
 * Configures gulp with a given gulpfile.
 * The returned gulp instances can be used to run tasks:
 * getGulp(gulpfile).start('some-tasks')
 *
 * Gulp is an instance of Orchestrator which inherits from EventEmitter.  Thus
 * you can add and remove event handlers with `on` and `removeEventHandler` to
 * add/remove listeners to Orchestrator`s events: `task_start`, `task_stop`,
 * `task_err`, `task_not_found`, `task_recursion` (there are also `start`,
 * `stop` and `err`, start runs when `gulp.start` is finishing, `stop` and
 * `err` when `gulp.stop` is in action, so they are not important for us).
 * I need to add and remove handlers because they will speak to various
 * sockets.
 *
 * @returns gulp instance
 */
function genPaths(list, dir) {
  list.push(path.join(dir, 'node_modules'));
  let parentDir = path.parse(dir).dir;
  if (dir != parentDir)
    return genPaths(list, parentDir);
  else
    return list;
}

function getGulp(gulpfile) {
  console.log('getGulp', gulpfile);
  let cwd = process.cwd(),
    paths = module.paths,
    dirname = path.dirname(gulpfile);
  module.paths = genPaths([], dirname);
  process.chdir(dirname);
  let script = new vm.Script(
      "'use strict'; const gulp = require('gulp'); require(gulpfile); module.export = gulp;",
      {filename: 'gulp-runner.js'}
    ),
    runner = script.runInNewContext({
      gulpfile: gulpfile,
      module: {},
      require: require,
    });
  module.paths = paths;
  process.chdir(cwd);
  return runner;
}

const gulpCache = new Map();

function handleException(socket, err) {
  console.error(err.message);
  console.error(err.stack);
  socket.end(JSON.stringify([0, {'data': err.toString(), 'type': 'error', 'silent': false}]));
}

function logEvents(socket, task, gulpInst) {
  console.log('logEvents', task);
  function errHandler(e) {
    console.log(e);
    removeListeners();
  }
  function taskErr(e) {
    console.log(e);
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'err',
        data: '\'' + e.task + '\' error after ' + prettyTime(e.hrDuration),
      }
    ]));
  }
  function taskStart(e) {
    console.log(e);
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'stdout',
        data: 'Starting \'' + e.task + '\'...',
      }
    ]));
  }
  function taskStop(e) {
    console.log('stop', e);
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'stdout',
        data: 'Finished \'' + e.task + '\' after ' + prettyTime(e.hrDuration),
      }
    ]));
    if (e.task == task)
      removeListeners();
  }
  function removeListeners() {
    console.log('removeListeners');
    gulpInst.removeListener('err', errHandler);
    gulpInst.removeListener('task_err', taskErr);
    gulpInst.removeListener('task_start', taskStart);
    gulpInst.removeListener('task_stop', taskStop);
  }
  gulpInst.on('err', errHandler);
  gulpInst.on('task_err', taskErr);
  gulpInst.on('task_start', taskStart);
  gulpInst.on('task_stop', taskStop);
}


const server = net.createServer((socket) => {
  socket.on('data', (msg) => {
    try {
      let decoded = JSON.parse(msg.toString());
      console.log('recieved:', decoded);
      let data = decoded[1],
          task = data.task,
          silent = Boolean(data.silent),
          requestID = decoded[0],
          gulpfile = data.gulpfile,
          gulpInst = gulpCache.get(gulpfile);
      if (!gulpInst) {
        gulpInst = getGulp(gulpfile);
        gulpCache.set(gulpfile, gulpInst);
      }

      // register listeners
      console.log('register listeners');
      logEvents(socket, task, gulpInst);

      // run the task
      console.log('gulp start', data.task);
      gulpInst.start(data.task);
    } catch (err) {
      handleException(socket, err);
    }
  });
});

if (require.main === module) {
  argv.option({
    'name': 'port',
    'short': 'p',
    'type': 'string',
    'description': 'port to bind to',
  });
  let args = argv.run(),
      port = parseInt(args.options.port || 3746);
  server.listen(port, () => {
      console.log('server running on localhost:' + port);
    });
}

module.exports = getGulp;
