'use strict';

const argv = require('argv');
const byline = require('byline');
const fs = require('fs');
const net = require('net');
const spawn = require('child_process').spawn;
const prettyTime = require('pretty-time');
const uncolor = require('uncolor');
const vm = require('vm');
const path = require('path');
const watch = require('node-watch');

let logFile = null;

// some task may use process.exit to exit (gulp-karma)
process.exit = () => {};

function genPaths(list, dir) {
  list.push(path.join(dir, 'node_modules'));
  const parentDir = path.parse(dir).dir;
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
  const cwd = process.cwd(),
    paths = module.paths,
    dirname = path.dirname(gulpfile);
  module.paths = genPaths([], dirname);
  process.chdir(dirname);
  const script = new vm.Script(
      "'use strict'; const gulp = require('gulp'); require(gulpfile); module.exports = gulp;",
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
  if (logFile)
    fs.appendFile(logFile, err.message + "\n" + err.stack + "\n");
}

function logEvents(socket, requestID, data, gulpInst) {
  gulpInst.on('err', (e) => {
    socket.write(JSON.stringify([
      requestID,
      {
        silent: false,
        type: 'err',
        data: e.message,
      }
    ]));
  });
  gulpInst.on('task_err', (e) => {
    socket.write(JSON.stringify([
      requestID,
      {
        silent: false,
        type: 'task_err',
        data: '\'' + e.task + '\' error after ' + prettyTime(e.hrDuration),
      }
    ]));
  });
  gulpInst.on('task_start', (e) => {
    socket.write(JSON.stringify([
      requestID,
      {
        silent: Boolean(data.silent),
        type: 'task_start',
        data: 'Starting \'' + e.task + '\'...',
      }
    ]));
  });
  gulpInst.on('task_stop', (e) => {
    socket.write(JSON.stringify([
      requestID,
      {
        silent: Boolean(data.silent),
        type: 'task_stop',
        data: 'Finished \'' + e.task + '\' after ' + prettyTime(e.hrDuration),
      }
    ]));
  });
}

// sniff on a writeable stream
const sniffQueue = [];

function sniff(writable) {
  const write = writable.write;
  writable.write = (string, encoding, fd) => {
    write.apply(process.stdout, arguments);
    sniffQueue.map((cb) => cb(string, encoding, fd))
  };
  return () => {writable.write = write;};
}

function sniffio(type, socket, string, enc, fd) {
  if (typeof string !== 'string')
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

let socketID = -1;
const logSockGf = new Map();;

const server = net.createServer((socket) => {
  socketID = socketID + 1;

  // new connection
  if (logFile) {
    fs.appendFile(logFile, 'new client\n');
    socket.on('end', () => fs.appendFile(logFile, 'client disconnected\n'));
  }

  sniffQueue.push.call(sniffQueue, sniffio.bind(null, 'stdout', socket), sniffio.bind(null, 'stderr', socket));

  socket.on('data', (msg) => {
    try {
      const decoded = JSON.parse(msg.toString()),
        requestID = decoded[0],
        data = decoded[1],
        silent = Boolean(data.silent),
        gulpfile = data.gulpfile,
        cache = gulpCache.get(gulpfile);
      let gulpInst = cache ? cache.gulpInst : null;
      if (!gulpInst) {
        gulpInst = getGulp(gulpfile);
        const watchGf = watch(
          gulpfile,
          {persistent: false, recursive: false},
          (filename) =>  {
            gulpCache.delete(filename);
            delete require.cache[filename];
          }
        );
        gulpCache.set(gulpfile, {gulp: gulpInst, watch: watchGf});
      }

      if (!logSockGf.get(socketID + ":" + gulpfile)) {
        // log events if the event handlers are not registered yet for this
        // socket & gulp instance
        logSockGf.set(socketID + ":" + gulpfile, true);
        logEvents(socket, 0, data, gulpInst);
      }

      // run the task
      if (data.type === 'start-tasks')
        gulpInst.start(data.args);
      else if (data.type === 'list-tasks') {
        const tasks = Object.keys(gulpInst.tasks);
        if (data.args === 'running')
          tasks = tasks.filter((task) => Boolean(gulpInst.tasks[task].running));
        socket.write(JSON.stringify([
          requestID, {type: 'list-tasks', tasks: tasks}
        ]));
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
    'log-file': 'log file to use'
  });
  const args = argv.run(),
    port = parseInt(args.options.port || 3746);
  logFile = args.options['log-file'] || null;
  server.listen(port, () => {
      if (logFile)
        fs.appendFile(logFile, "server running on localhost:" + port + "\n");
      sniff(process.stdout);
      sniff(process.stderr);
    });
}

module.exports = {
  getGulp: getGulp,
  logEvents: logEvents,
};
