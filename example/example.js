const jsnx = require('jsnetworkx')
const swarm = require('..')

const TO_SPAWN = 32

const G = new jsnx.DiGraph()
let lastConnections = []
const peers = new Set()
const peersTitle = document.getElementById('peers-title')
const connectionsTitle = document.getElementById('connections-title')

bootstrap().then(draw)

async function bootstrap () {
  let toSpawn = TO_SPAWN
  while (toSpawn--) {
    createPeer()
  }
}

function addPeer (id) {
  id = Buffer.isBuffer(id) ? id.toString('hex') : id
  if (!peers.has(id)) {
    peers.add(id)
    G.addNode(id)
    peersTitle.innerHTML = peers.size
  }
}

function createPeer () {
  const sw = swarm({
    urls: ['localhost:4000']
  })

  sw.on('connection', (peer, info) => {
    const connection = [sw.id.toString('hex'), info.id.toString('hex')].sort()
    sw.info({ type: 'connection', channel: info.channel.toString('hex'), peers: connection })
  })

  sw.on('connection-closed', (peer, info) => {
    const connection = [sw.id.toString('hex'), info.id.toString('hex')].sort()
    sw.info({ type: 'disconnection', channel: info.channel.toString('hex'), peers: connection })
  })

  sw.on('info', ({ connections }) => {
    const exists = (conn, list) => list.find(newConn => conn[0] === newConn[0] && conn[1] === newConn[1])

    connections.forEach(conn => {
      if (exists(conn, lastConnections)) {
        return
      }

      const [peerOne, peerTwo] = conn
      addPeer(peerOne)
      addPeer(peerTwo)
      G.addEdge(peerOne, peerTwo)
      connectionsTitle.innerHTML = connections.length
    })

    lastConnections.filter(conn => !exists(conn, connections))
      .forEach(conn => {
        const [peerOne, peerTwo] = conn
        G.removeEdge(peerOne, peerTwo)
      })

    lastConnections = connections
  })

  sw.on('error', (err, info) => {
    console.log(err, info.id.toString('hex'))
  })

  sw.join(Buffer.from('0011', 'hex'))
  addPeer(sw.id)

  return sw
}

function draw () {
  jsnx.draw(G, {
    element: '#canvas',
    layoutAttr: {
      linkDistance: 100
    },
    withLabels: true,
    // labelStyle: { fill: 'rebeccapurple' },
    labels: (d) => d.node.slice(0, 4),
    nodeStyle: {
      fill: 'white',
      strokeWidth: 4,
      stroke: (d) => {
        const mostSignificant = parseInt(d.node.slice(0, 2), 16)
        const percent = mostSignificant / 255
        const hue = percent * 360
        return `hsl(${hue}, 100%, 50%)`
      }
    },
    nodeAttr: {
      r: 16
    },
    stickyDrag: true
  }, true)
}
