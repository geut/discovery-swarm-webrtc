const swarm = require('..')

const sw = window.sw = swarm({
  urls: ['localhost:4000']
})

sw.on('connection', (peer, info) => {
  window.peer = peer
  console.log('new connection', info)
})

sw.join('test')
