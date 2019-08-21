const jsnx = require('jsnetworkx')
const swarm = require('..')

const TO_SPAWN = 32

const G = new jsnx.DiGraph()
const connectionsByPeer = new Map()
const connections = new Set()
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
  if (!connectionsByPeer.has(id)) {
    connectionsByPeer.set(id, [])
  }
}

function createPeer () {
  const sw = swarm({
    urls: ['localhost:4000']
  })

  sw.on('connection', (peer, info) => {
    const channel = info.channel.toString('hex')
    sw.info({ channel, peers: sw.peers(info.channel).map(peer => peer.id.toString('hex')) })
  })

  sw.on('connection-closed', (peer, info) => {
    const channel = info.channel.toString('hex')
    sw.info({ channel, peers: sw.peers(info.channel).map(peer => peer.id.toString('hex')) })
  })

  sw.on('info', ({ channel, peerId, peers }) => {
    addPeer(peerId)
    peers.forEach(remotePeerId => {
      addPeer(remotePeerId)
    })

    const lastConnections = connectionsByPeer.get(peerId)
    connectionsByPeer.set(peerId, peers)

    lastConnections
      .forEach(remotePeerId => {
        if (!peers.includes(remotePeerId)) {
          const connectionId = [peerId, remotePeerId].sort()
          G.removeEdge(connectionId[0], connectionId[1])
          connections.delete(connectionId.join(':'))
        }
      })

    peers.forEach(remotePeerId => {
      const connectionId = [peerId, remotePeerId].sort()
      if (!connections.has(connectionId.join(':'))) {
        G.addEdge(connectionId[0], connectionId[1])
        connections.add(connectionId.join(':'))
      }
      connectionsTitle.innerHTML = connections.size
    })
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
