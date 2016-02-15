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
const net = require('net');
const spawn = require('child_process').spawn;
const byline = require('byline');
const uncolor = require('uncolor');

const gulpMsg = /^\[[0-9:]+\] (Starting|Finished) /

function handleException(socket, err) {
  console.error(err.message);
  console.error(err.stack);
  socket.end(JSON.stringify([0, {'data': err.toString(), 'type': 'error', 'silent': false}]));
}

const server = net.createServer((socket) => {
  socket.on('data', (msg) => {
    try {
      let decoded = JSON.parse(msg.toString());
      console.log('recieved:', decoded);
      let data = decoded[1],
          task = data.task,
          silent = Boolean(data.silent),
          requestID = decoded[0];
      let proc = spawn('gulp', ['--no-color', '--gulpfile', data.gulpfile, data.task]);
      byline(proc.stdout).on('data', (data) => {
        data = data.toString();
        if (!silent || gulpMsg.test(data)) {
          console.log('sending:stdout', [0, data]);
          socket.write(JSON.stringify([
            0,  // invoke the channel callback
            {
              type: 'stdout',
              task: task,
              data: uncolor(data).replace(/\t/g, ' '),
            }
          ]));
        }
      });
      byline(proc.stderr).on('data', (data) => {
        data = data.toString();
        console.log('sending:stderr', [0, data]);
        socket.write(JSON.stringify([
          0,
          {
            type: 'stderr',
            task: task,
            data: uncolor(data).replace(/\t/g, ' '),
          }
        ]));
      });
      proc.on('close', (code) => {
        code = code.toString();
        console.log('closing', [0, code]);
        socket.write(JSON.stringify([
          0,
          {
            type: 'close',
            task: task,
            silent: !silent,
            data: uncolor(code).replace(/\t/g, ' '),
          }
        ]));
      });
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
