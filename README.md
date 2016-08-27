# SPEEDY

This is a replacement for gulp cli.  It runs a node server which executes gulp
tasks.  This makes execution of gulp tasks much faster since the server does not
need to reinterpret the gulp file, which takes noticeable time.

```bash
speedy task [task, ...]
```

Runs a gulp task(s), the same way as `gulp` does.

There is a drawback though: if you want to run tasks from different gulpfiles
they have to use full paths, otherwise the server will get confused and you
will need to restart the background server.  The background server is started
when you execute `seepdy` for the first time.


# GULP VIM CHANNEL PLUGIN

You need vim with `+channel` support.  The plugin executes gulp tasks in
a background vim channel.  The plugin runs a node server that imports your gulp
file which makes running your gulp files much faster than on command line,
since only the initial run has to interpret the gulp file.

Vim commands:

```viml
:Gulp task [task, ...]
```

Runs a gulp task. The output is redirected to vim.  You can inspect it with vim
`:msg` command.  Upon initial invocation it will also start the background
server.  The server will be shut down when you exit vim.

```viml
:GulpStop
:GulpStart
:GulpRestart
```
These commands stop, start and restart the background node server.  This is
useful if you want to switch to another project.
