import { test } from 'node:test'
import assert from 'node:assert'
import { parseHostsFile, parseRouteFile, resolveHost } from './hostResolver'

test('parseHostsFile 从 /etc/hosts 提取 host.docker.internal 映射', () => {
  const content = [
    '127.0.0.1\tlocalhost',
    '172.17.0.1\thost.docker.internal',
    '192.168.2.100\thost.docker.internal lxhost',
  ].join('\n')
  assert.strictEqual(parseHostsFile(content), '172.17.0.1')
})

test('parseHostsFile 无映射时返回空串', () => {
  assert.strictEqual(parseHostsFile('127.0.0.1\tlocalhost\n'), '')
})

test('parseRouteFile 从 /proc/net/route 提取默认网关 IP', () => {
  const content = [
    'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
    'eth0\t00000000\t0110A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  ].join('\n')
  assert.strictEqual(parseRouteFile(content), '192.168.16.1')
})

test('parseRouteFile 无默认路由时返回空串', () => {
  const content = [
    'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
    'eth0\t0010A8C0\t00000000\t0001\t0\t0\t0\t00F0FFFF\t0\t0\t0',
  ].join('\n')
  assert.strictEqual(parseRouteFile(content), '')
})

test('resolveHost 将 host.docker.internal 替换为环境变量指定地址', () => {
  const prev = process.env.LX_HOST_ADDR
  process.env.LX_HOST_ADDR = '192.168.2.100'
  try {
    assert.strictEqual(resolveHost('http://host.docker.internal:5244/api'), 'http://192.168.2.100:5244/api')
    assert.strictEqual(resolveHost('http://HOST.DOCKER.INTERNAL:5244'), 'http://192.168.2.100:5244')
  } finally {
    if (prev === undefined) delete process.env.LX_HOST_ADDR
    else process.env.LX_HOST_ADDR = prev
  }
})

test('resolveHost 不包含 host.docker.internal 时原样返回', () => {
  assert.strictEqual(resolveHost('http://192.168.2.100:5244/api'), 'http://192.168.2.100:5244/api')
  assert.strictEqual(resolveHost(''), '')
})
