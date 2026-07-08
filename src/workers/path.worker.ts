/**
 * Pathfinding worker: owns a RoadGraphIndex mirror of the road network and
 * answers batched path queries off the main thread. Protocol:
 *
 *  main → worker
 *    { type: 'graph', snapshot }                 full graph replace
 *    { type: 'congestion', updates: [id, c][] }  live cost update
 *    { type: 'path', id, from, to }              path request
 *    { type: 'flow', id, target }                flow-field request
 *
 *  worker → main
 *    { type: 'path', id, nodes, edges, cost } | { type: 'path', id, nodes: null }
 *    { type: 'flow', id, field: [node, next, edge][] }
 */
import { RoadGraphIndex, type GraphSnapshot } from '@/traffic/RoadGraphIndex';

let index: RoadGraphIndex | null = null;

interface GraphMessage {
  type: 'graph';
  snapshot: GraphSnapshot;
}
interface CongestionMessage {
  type: 'congestion';
  updates: [number, number][];
}
interface PathMessage {
  type: 'path';
  id: number;
  from: number;
  to: number;
}
interface FlowMessage {
  type: 'flow';
  id: number;
  target: number;
}
type InMessage = GraphMessage | CongestionMessage | PathMessage | FlowMessage;

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'graph':
      index = RoadGraphIndex.fromSnapshot(message.snapshot);
      break;
    case 'congestion':
      if (index) {
        for (const [edgeId, congestion] of message.updates) {
          index.setCongestion(edgeId, congestion);
        }
      }
      break;
    case 'path': {
      const result = index?.findPath(message.from, message.to) ?? null;
      if (result) {
        self.postMessage({
          type: 'path',
          id: message.id,
          nodes: result.nodes,
          edges: result.edges,
          cost: result.cost,
        });
      } else {
        self.postMessage({ type: 'path', id: message.id, nodes: null });
      }
      break;
    }
    case 'flow': {
      const field = index?.buildFlowField(message.target) ?? new Map();
      const flat: [number, number, number][] = [];
      for (const [node, step] of field) flat.push([node, step.next, step.edge]);
      self.postMessage({ type: 'flow', id: message.id, field: flat });
      break;
    }
  }
};
