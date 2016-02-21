" :Gulp {task} [gulpfile]
"   run gulp and redirect the output to a file, track changes of this file
"   open a socket (if not yet opened) and send status messages to it whenever
"   the file changes
"   connect vim to that socket with a callback which will show the messages.
"
"   This is useful for tasks which are watching some files.  Its nice to see
"   in the terminal that a task has finished.
"
"   write it in node :)
"   First version should just show that a task has started / or a task has
"   finished

call ch_logfile('/tmp/ch.log')
let s:lbuf = [] " log buffer

fun! GulpHandler(handle, msg)
  let data = substitute(a:msg['data'], '\_s\+$', '', '')
  let type = a:msg['type']
  if (type != 'err' && type != 'task_err' && data =~? '\v^\[[0-9:]+\] working directory changed to')
    return
  endif
  let msg = 'gulp: ' . data
  call add(s:lbuf, msg)

  if mode() != "c" && type != "stdout" && !a:msg["silent"]
      echomsg msg
  endif
endfun

fun! StartGulpServer()
  if !exists('s:gulp_job') || job_status(s:gulp_job) != 'run'
    let cmd = ['/bin/sh', '-c', 'node --harmony ' . split(globpath(&rtp, 'scripts/gulp-server.js'), "\n")[0] . (has('unix') ? ' > /tmp/gs.log 2>&1' : '')]
    let s:gulp_job = job_start(cmd)
  endif
  " echomsg job_status(s:gulp_job)
  let s:gulp_handle = ch_open('localhost:3746', {'callback': 'GulpHandler', 'waittime': 200})
endfun

fun! StopGulpServer()
  if exists('s:gulp_handle')
    try
      call ch_close(s:gulp_handle)
    catch /E906/
    endtry
    unlet s:gulp_handle
  endif
  if exists('s:gulp_job')
    try
      call job_stop(s:gulp_job)
    endtry
    unlet s:gulp_job
  endif
endfun

" let g:gulpfile = '/home/marcin/webdev/rubble-workflow/rubble-workflow/gulpfile.js'
fun! Gulp(bang, tasks)
  let gulpfile = findfile('gulpfile.js', expand('%:p:h') . ';/')
  if empty(gulpfile)
    echoerr "gulpfile not found"
    return
  endif
  let data = {'type': 'start-tasks', 'args': split(a:tasks, '[[:space:]]\+'), 'silent': !empty(a:bang), 'gulpfile': fnamemodify(gulpfile, ':p')}
  call ch_sendexpr(s:gulp_handle, data, {"callback": "GulpHandler"})
endfun

fun! GulpAutoDetect()
  if !exists('s:gulp_handle') && !empty(findfile('gulpfile.js', expand('%:p:h') . ';/'))
    call StartGulpServer()
  endif
endfun

augroup GulpAutoDetect
  au!
  au BufRead * call GulpAutoDetect()
  au VimEnter * call GulpAutoDetect()
  au VimLeave * call StopGulpServer()
augroup END

fun! ListGulpTasks(ArgLead, CmdLine, CursorPos)
  let gulpfile = findfile('gulpfile.js', expand('%:p:h') . ';/')
  if empty(gulpfile)
    return ""
  endif
  let data = ch_sendexpr(s:gulp_handle, {'type': 'list-tasks', 'args': 'all', 'gulpfile': fnamemodify(gulpfile, ':p')})
  return join(data["tasks"], "\n")
endfun

com! -bang -nargs=+ -complete=custom,ListGulpTasks Gulp :call Gulp(<q-bang>, <q-args>)
com! GulpStatus :echo s:gulp_job . " [channel: " . ch_status(s:gulp_handle) . "]"
com! -count=0 GulpLog :echo join(<count> == 0 ? s:lbuf : s:lbuf[-<count>:], "\n")
