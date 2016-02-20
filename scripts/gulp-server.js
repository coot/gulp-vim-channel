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
        type: 'err',
        data: '\'' + e.task + '\' error after ' + prettyTime(e.hrDuration),
      }
    ]));
  });
  gulpInst.on('task_start', (e) => {
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'stdout',
        data: 'Starting \'' + e.task + '\'...',
      }
    ]));
  });
  gulpInst.on('task_stop', (e) => {
    socket.write(JSON.stringify([
      0,
      {
        silent: false,
        type: 'stdout',
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

  function sniffio(string, enc, fd) {
    if (typeof string !== 'string')
      return;
    string.split(/\n/).forEach((chunk) => {
      if (chunk.trim())
        socket.write(JSON.stringify([
          0,
          {
            silent: false,
            type: 'stdout',
            data: uncolor(chunk),
          }
        ]));
    });
  };
  sniff(process.stdout, sniffio);
  sniff(process.stderr, sniffio);

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

module.exports = {
  getGulp: getGulp,
  logEvents: logEvents,
};
