'use strict';

const argv = require('argv');
const byline = require('byline');
const net = require('net');
const spawn = require('child_process').spawn;
const prettyTime = require('pretty-time');
const uncolor = require('uncolor');
const vm = require('vm');
const path = require('path');

// some task may use process.exit to exit (gulp-karma)
process.exit = () => {};

function genPaths(list, dir) {
  list.push(path.join(dir, 'node_modules'));
  let parentDir = path.parse(dir).dir;
  if (dir != parentDir)
    return genPaths(list, parentDir);
  else
    return list;
}

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
function getGulp(gulpfile) {
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

function logEvents(socket, data, gulpInst) {
  gulpInst.on('err', (e) => {
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'err',
        data: e.message,
      }
    ]));
  });
  gulpInst.on('task_err', (e) => {
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'task_err',
        data: '\'' + e.task + '\' error after ' + prettyTime(e.hrDuration),
      }
    ]));
  });
  gulpInst.on('task_start', (e) => {
    socket.write(JSON.stringify([
      0,
      {
        silent: Boolean(data.silent),
        type: 'task_start',
        data: 'Starting \'' + e.task + '\'...',
      }
    ]));
  });
  gulpInst.on('task_stop', (e) => {
    socket.write(JSON.stringify([
      0,
      {
        silent: Boolean(data.silent),
        type: 'task_stop',
        data: 'Finished \'' + e.task + '\' after ' + prettyTime(e.hrDuration),
      }
    ]));
  });
}

// sniff on a writeable stream
function sniff(writable, callback) {
  var write = writable.write;
  writable.write = (string, encoding, fd) => {
    write.apply(process.stdout, arguments);
    callback(string, encoding, fd);
  };
  return () => {writable.write = write;};
}

const server = net.createServer((socket) => {
  // new connection

  let beQuiet = false;
  function sniffio(type, string, enc, fd) {
    if (beQuiet || typeof string !== 'string')
      return;
    string.split(/\n/).forEach((chunk) => {
      if (chunk.trim())
        socket.write(JSON.stringify([
          0,
          {
            silent: false,
            type: type,
            data: uncolor(chunk),
          }
        ]));
    });
  };
  sniff(process.stdout, sniffio.bind(null, 'stdout'));
  sniff(process.stderr, sniffio.bind(null, 'stderr'));

  socket.on('data', (msg) => {
    try {
      let decoded = JSON.parse(msg.toString());
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

      if (gulpInst._eventsCount === 0)
        logEvents(socket, data, gulpInst);

      // run the task
      if (data.type === 'start-tasks')
        gulpInst.start(data.args);
      else if (data.type === 'list-tasks') {
        let tasks;
        if (data.args === 'running')
          tasks = Object.keys(gulpInst.tasks)
            .filter((task) => Boolean(gulpInst.tasks[task].running));
        else
          tasks = Object.keys(gulpInst.tasks);
        socket.write(JSON.stringify([
          requestID, {type: 'list-tasks', tasks: tasks}
        ]));
        beQuiet = true;
        console.log(tasks);
        beQuiet = false;
      }
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

module.exports = {
  getGulp: getGulp,
  logEvents: logEvents,
};
