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

fun! GulpHandler(handle, msg)
  let data = a:msg['data']
  if a:msg['type'] == 'close'
    return
  elseif (a:msg['type'] != 'error' && data =~? '\v^\[[0-9:]+\] working directory changed to')
    return
  endif
  echomsg "gulp: " . data
endfun

fun! StartGulpServer()
  if !exists('s:gulp_job') || job_status(s:gulp_job) != 'run'
    let cmd = ['/bin/sh', '-c', 'node --harmony ' . split(globpath(&rtp, 'scripts/gulp-server.js'), "\n")[0] . (has('unix') ? ' > /tmp/gs.log 2>&1' : '')]
    let s:gulp_job = job_start(cmd, {'killonexit': 1})
  endif
  " echomsg job_status(s:gulp_job)
  sleep 100m
  let s:gulp_handle = ch_open('localhost:3746', {'callback': 'GulpHandler', 'timeout': 500})

  " DEBUG
  let g:gulp_job = s:gulp_job
  let g:gulp_handle = s:gulp_handle
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
fun! Gulp(bang, task)
  let gulpfile = findfile('gulpfile.js', expand('%:p:h') . ';/')
  if empty(gulpfile)
    echoerr "gulpfile not found"
    return
  endif
  let data = {'task': a:task, 'gulpfile': gulpfile, 'silent': a:bang == "!" ? v:true : v:false}
  call ch_sendexpr(s:gulp_handle, data)
endfun

fun! GulpAutoDetect()
  if !exists('s:gulp_handle') && !empty(findfile('gulpfile.js', expand('%:p:h') . ';/'))
    call StartGulpServer()
  endif
endfun

augroup GulpAutoDetect
  au!
  au BufRead * call GulpAutoDetect()
  au VimLeave * call StopGulpServer()
augroup END

com! -bang -nargs=1 Gulp :call Gulp(<q-bang>, <q-args>)
