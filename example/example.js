const jsnx = require('jsnetworkx')
const swarm = require('..')

const TO_SPAWN = 32

const G = new jsnx.DiGraph()
const connections = new Set()

bootstrap().then(draw)

async function bootstrap () {
  let toSpawn = TO_SPAWN
  while (toSpawn--) {
    createPeer()
  }
}

function createPeer () {
  const sw = swarm({
    urls: ['localhost:4000']
  })

  sw.on('connection', (peer, info) => {
    const connection = [sw.id.toString('hex'), info.id.toString('hex')].sort()
    const connectionId = connection.join('-')
    if (!connections.has(connectionId)) {
      G.addEdge(...connection)
      connections.add(connectionId)
      draw()
    }
  })

  sw.on('connection-closed', (peer, info) => {
    const connection = [sw.id.toString('hex'), info.id.toString('hex')].sort()
    const connectionId = connection.join('-')
    if (connections.has(connectionId)) {
      G.removeEdge(...connection)
      connections.delete(connectionId)
      draw()
    }
  })

  sw.on('error', (err, info) => {
    console.log(err)
  })

  sw.join(Buffer.from('0011', 'hex'))
  console.log('enter', sw.id.toString('hex'))
  G.addNode(sw.id.toString('hex'))

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
  })
}
