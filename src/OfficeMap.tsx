import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { RoleId } from './types';

/**
 * 도트 사무실 맵. 원본 그림은 195x234 픽셀이고 화면 너비에 맞춰 키웁니다.
 * 캐릭터는 길(노드와 통로)을 따라 걸어서 자리와 대표실을 오갑니다.
 */
const MAP_W = 195;
const MAP_H = 234;
const SPRITE_W = 16;
const SPRITE_H = 24;
const SPEED = 36; // 원본 픽셀/초

const BG = require('../assets/office/office_bg.png');
const FG = require('../assets/office/office_fg.png');
const SHEET = require('../assets/office/agents.png');

const ROW: Record<RoleId | 'ceo', number> = {
  pm: 0,
  planner: 1,
  designer: 2,
  publisher: 3,
  pl: 4,
  developer: 5,
  tester: 6,
  ceo: 7,
};

// 스프라이트 시트 프레임 묶음 (각 3프레임)
const GROUP = { type: 0, down: 1, up: 2, side: 3, stand: 4 };

type Dir = 'up' | 'down' | 'left' | 'right';

// 길 노드 (스프라이트 왼쪽 위 좌표, 원본 픽셀)
const NODES: Record<string, [number, number]> = {
  seat_planner: [10, 28],
  seat_designer: [160, 28],
  seat_publisher: [8, 96],
  seat_pm: [112, 96],
  seat_pl: [160, 96],
  seat_developer: [22, 184],
  seat_tester: [140, 184],
  L_top: [44, 28],
  L_mid: [44, 96],
  L_lane: [44, 128],
  L_low: [44, 168],
  dev_up: [22, 168],
  C_lane: [89, 128],
  C_in: [89, 50],
  W0: [74, 50],
  W1: [106, 50],
  R_lane: [136, 128],
  R_mid: [136, 96],
  R_top: [136, 28],
  T_lane: [150, 128],
  T_low: [150, 168],
  test_up: [140, 168],
};

const EDGES: [string, string][] = [
  ['seat_planner', 'L_top'],
  ['L_top', 'L_mid'],
  ['L_mid', 'L_lane'],
  ['seat_publisher', 'L_mid'],
  ['L_lane', 'C_lane'],
  ['C_lane', 'R_lane'],
  ['R_lane', 'R_mid'],
  ['R_mid', 'R_top'],
  ['R_top', 'seat_designer'],
  ['seat_pm', 'R_mid'],
  ['seat_pl', 'R_mid'],
  ['C_lane', 'C_in'],
  ['C_in', 'W0'],
  ['C_in', 'W1'],
  ['L_lane', 'L_low'],
  ['L_low', 'dev_up'],
  ['dev_up', 'seat_developer'],
  ['R_lane', 'T_lane'],
  ['T_lane', 'T_low'],
  ['T_low', 'test_up'],
  ['test_up', 'seat_tester'],
];

const ADJ: Record<string, string[]> = {};
for (const [a, b] of EDGES) {
  (ADJ[a] ??= []).push(b);
  (ADJ[b] ??= []).push(a);
}

function dist(a: string, b: string) {
  const [ax, ay] = NODES[a];
  const [bx, by] = NODES[b];
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** 가장 짧은 길 (노드 목록, 출발 노드 제외) */
function route(from: string, to: string): string[] {
  if (from === to) return [];
  const best: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set([from]);
  while (open.size) {
    let cur = '';
    for (const n of open) if (!cur || best[n] < best[cur]) cur = n;
    open.delete(cur);
    if (cur === to) break;
    for (const nb of ADJ[cur] ?? []) {
      const d = best[cur] + dist(cur, nb);
      if (best[nb] === undefined || d < best[nb]) {
        best[nb] = d;
        prev[nb] = cur;
        open.add(nb);
      }
    }
  }
  const path: string[] = [];
  let n = to;
  while (n !== from) {
    if (!prev[n]) return [];
    path.unshift(n);
    n = prev[n];
  }
  return path;
}

const WAIT_SPOTS = ['C_in', 'W0', 'W1', 'C_lane'];

export type AgentMode = 'work' | 'wait' | 'idle';

export interface AgentState {
  mode: AgentMode;
  text?: string;
}

const BUBBLE: Record<AgentMode, { bg: string; fg: string; dot?: string }> = {
  work: { bg: '#FFF4DC', fg: '#1E2238', dot: '#2E9C74' },
  wait: { bg: '#F5C04A', fg: '#1E2238' },
  idle: { bg: '#3A3F5C', fg: '#E6E2F5' },
};

function Sprite(props: { row: number; frame: number; s: number; flip?: boolean }) {
  const { s } = props;
  return (
    <View
      style={{
        width: SPRITE_W * s,
        height: SPRITE_H * s,
        overflow: 'hidden',
        transform: props.flip ? [{ scaleX: -1 }] : undefined,
      }}
    >
      <Image
        source={SHEET}
        fadeDuration={0}
        resizeMode="stretch"
        style={{
          position: 'absolute',
          width: 240 * s,
          height: 192 * s,
          left: -props.frame * SPRITE_W * s,
          top: -props.row * SPRITE_H * s,
        }}
      />
    </View>
  );
}

/** 걷기 담당: 목표 노드가 바뀌면 길을 따라 한 칸씩 이동합니다. */
class Walker {
  pos: Animated.ValueXY;
  node: string;
  dir: Dir | null = null;
  private target: string;
  private walking = false;
  private s: number;
  private onChange: () => void;

  constructor(role: RoleId, s: number, onChange: () => void) {
    this.node = `seat_${role}`;
    this.target = this.node;
    this.s = s;
    this.onChange = onChange;
    const [x, y] = NODES[this.node];
    this.pos = new Animated.ValueXY({ x: x * s, y: y * s });
  }

  setScale(s: number) {
    if (s === this.s) return;
    this.s = s;
    const [x, y] = NODES[this.node];
    this.pos.setValue({ x: x * s, y: y * s });
  }

  setTarget(t: string) {
    this.target = t;
    if (!this.walking) this.step();
  }

  stop() {
    this.walking = false;
    this.pos.stopAnimation();
  }

  private step() {
    const path = route(this.node, this.target);
    if (path.length === 0) {
      this.walking = false;
      if (this.dir !== null) {
        this.dir = null;
        this.onChange();
      }
      return;
    }
    this.walking = true;
    const next = path[0];
    const [cx, cy] = NODES[this.node];
    const [nx, ny] = NODES[next];
    this.dir = nx > cx ? 'right' : nx < cx ? 'left' : ny > cy ? 'down' : 'up';
    this.onChange();
    Animated.timing(this.pos, {
      toValue: { x: nx * this.s, y: ny * this.s },
      duration: (dist(this.node, next) / SPEED) * 1000,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || !this.walking) return;
      this.node = next;
      this.step();
    });
  }
}

const ROLES_ORDER: RoleId[] = ['planner', 'designer', 'pm', 'publisher', 'pl', 'developer', 'tester'];

function AgentSprite(props: { role: RoleId; walker: Walker; mode: AgentMode; s: number; tick: number }) {
  const { role, walker, s } = props;
  const atSeat = walker.node === `seat_${role}`;
  let group: number;
  if (walker.dir === 'left' || walker.dir === 'right') group = GROUP.side;
  else if (walker.dir === 'up') group = GROUP.up;
  else if (walker.dir === 'down') group = GROUP.down;
  else group = atSeat && props.mode === 'work' ? GROUP.type : GROUP.stand;
  const frame = group * 3 + (props.tick % 3);
  return (
    <Animated.View pointerEvents="none" style={[styles.abs, { transform: walker.pos.getTranslateTransform() }]}>
      <Sprite row={ROW[role]} frame={frame} s={s} flip={walker.dir === 'left'} />
    </Animated.View>
  );
}

function AgentBubble(props: { walker: Walker; state: AgentState; name: string; s: number; onPress: () => void }) {
  const { walker, state, s } = props;
  const x = NODES[walker.node][0];
  const anchor = x < 40 ? 'left' : x > 130 ? 'right' : 'center';
  const b = BUBBLE[state.mode];
  const text = state.mode === 'idle' ? `${state.text ?? '쉬는 중'} Zz` : state.text ?? '';
  const w = SPRITE_W * s;
  return (
    <Animated.View style={[styles.abs, { transform: walker.pos.getTranslateTransform() }]} pointerEvents="box-none">
      <Pressable
        onPress={props.onPress}
        accessibilityRole="button"
        accessibilityLabel={`${props.name}: ${text}`}
        style={{ width: w, height: SPRITE_H * s }}
      />
      {!!text && (
        <View
          pointerEvents="box-none"
          style={[
            styles.bubbleWrap,
            { bottom: SPRITE_H * s + 2 },
            anchor === 'left'
              ? { left: -4, alignItems: 'flex-start' }
              : anchor === 'right'
                ? { right: -4, alignItems: 'flex-end' }
                : { left: w / 2 - 80, alignItems: 'center' },
          ]}
        >
          <Pressable onPress={props.onPress} style={[styles.bubble, { backgroundColor: b.bg }]}>
            {state.mode === 'wait' && <Text style={styles.bang}>!</Text>}
            {b.dot && <View style={[styles.dot, { backgroundColor: b.dot }]} />}
            <Text style={[styles.bubbleText, { color: b.fg }]} numberOfLines={1}>
              {props.name} · {text}
            </Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

export function OfficeMap(props: {
  width: number;
  agents: Record<RoleId, AgentState>;
  names: Record<RoleId, string>;
  onPressAgent: (role: RoleId) => void;
  onPressCeo: () => void;
}) {
  const s = props.width / MAP_W;
  const [tick, setTick] = useState(0);
  const [, setVersion] = useState(0);
  const walkers = useRef<Record<RoleId, Walker> | null>(null);
  if (!walkers.current) {
    const bump = () => setVersion((v) => v + 1);
    walkers.current = Object.fromEntries(ROLES_ORDER.map((r) => [r, new Walker(r, s, bump)])) as Record<
      RoleId,
      Walker
    >;
  }
  const w = walkers.current;
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 180);
    return () => {
      clearInterval(id);
      ROLES_ORDER.forEach((r) => w[r].stop());
    };
  }, [w]);
  useEffect(() => {
    ROLES_ORDER.forEach((r) => w[r].setScale(s));
  }, [s, w]);

  // 결재 대기 중인 팀원에게 대표실 자리를 순서대로 배정
  const waiting = ROLES_ORDER.filter((r) => props.agents[r].mode === 'wait');
  const target = (r: RoleId) => {
    const i = waiting.indexOf(r);
    return i >= 0 ? WAIT_SPOTS[Math.min(i, WAIT_SPOTS.length - 1)] : `seat_${r}`;
  };
  const targetKey = ROLES_ORDER.map(target).join(',');
  useEffect(() => {
    ROLES_ORDER.forEach((r) => w[r].setTarget(target(r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);
  const label = (x: number, y: number, text: string) => (
    <Text style={[styles.label, { left: x * s, top: y * s }]}>{text}</Text>
  );

  return (
    <View style={{ width: props.width, height: MAP_H * s, overflow: 'hidden', backgroundColor: '#2B1E2F' }}>
      <Image source={BG} fadeDuration={0} resizeMode="stretch" style={[styles.abs, { width: MAP_W * s, height: MAP_H * s }]} />
      {ROLES_ORDER.map((r) => (
        <AgentSprite key={r} role={r} walker={w[r]} mode={props.agents[r].mode} s={s} tick={tick} />
      ))}
      <View pointerEvents="none" style={[styles.abs, { left: 89 * s, top: 14 * s }]}>
        <Sprite row={ROW.ceo} frame={GROUP.stand * 3 + (tick % 12 === 0 ? 2 : 0)} s={s} />
      </View>
      <Image
        source={FG}
        fadeDuration={0}
        resizeMode="stretch"
        pointerEvents="none"
        style={[styles.abs, { width: MAP_W * s, height: MAP_H * s }]}
      />
      {label(4, 78, '기획실')}
      {label(158, 78, '디자인실')}
      {label(4, 158, '개발실')}
      {label(75, 158, '휴게실')}
      {label(166, 158, '테스트룸')}
      <Pressable
        onPress={props.onPressCeo}
        accessibilityLabel={`대표실, 결재 대기 ${waiting.length}건`}
        style={[styles.ceoSign, { left: 64 * s, top: 77 * s }]}
      >
        <Text style={styles.ceoText}>대표실</Text>
        {waiting.length > 0 && (
          <View style={styles.ceoBadge}>
            <Text style={styles.ceoBadgeText}>결재 {waiting.length}</Text>
          </View>
        )}
      </Pressable>
      {ROLES_ORDER.map((r) => (
        <AgentBubble
          key={r}
          walker={w[r]}
          state={props.agents[r]}
          name={props.names[r]}
          s={s}
          onPress={() => props.onPressAgent(r)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
  bubbleWrap: { position: 'absolute', width: 160 },
  bubble: {
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: '#0E1020',
  },
  bubbleText: { fontSize: 10, fontWeight: '700', flexShrink: 1 },
  dot: { width: 6, height: 6 },
  bang: {
    fontSize: 11,
    fontWeight: '900',
    color: '#F5C04A',
    backgroundColor: '#1E2238',
    paddingHorizontal: 3,
  },
  label: {
    position: 'absolute',
    backgroundColor: '#2B1E2F',
    color: '#FFF4DC',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  ceoSign: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F5C04A',
    borderWidth: 1,
    borderColor: '#0E1020',
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  ceoText: { fontSize: 9, fontWeight: '900', color: '#1E2238' },
  ceoBadge: { backgroundColor: '#D94A4A', paddingHorizontal: 3 },
  ceoBadgeText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF' },
});
