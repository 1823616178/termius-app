/**
 * Pure TypeScript RFC 9106 Argon2id + RFC 7693 BLAKE2b implementation.
 * Zero external dependencies and zero OpenSSL Argon2 requirements so it runs identically
 * in Electron (BoringSSL) and standard Node.js runtimes.
 */

const BLAKE2B_IV_LO = new Uint32Array([
  0xf3bcc908, 0x84caa73b, 0xfe94f82b, 0x5f1d36f1, 0xade682d1, 0x2b3e6c1f, 0xfb41bd6b, 0x137e2179
])
const BLAKE2B_IV_HI = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
])

const BLAKE2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]
]

const b2vLo = new Uint32Array(16)
const b2vHi = new Uint32Array(16)
const b2mLo = new Uint32Array(16)
const b2mHi = new Uint32Array(16)

function b2G(a: number, b: number, c: number, d: number, xi: number, yi: number): void {
  let lo: number
  let hi: number
  let carry: number

  lo = b2vLo[a]! + b2vLo[b]!
  carry = lo > 0xffffffff ? 1 : 0
  lo = (lo >>> 0) + b2mLo[xi]!
  if (lo > 0xffffffff) carry++
  hi = (b2vHi[a]! + b2vHi[b]! + b2mHi[xi]! + carry) >>> 0
  b2vLo[a] = lo >>> 0
  b2vHi[a] = hi

  // d ^= a, rotr 32 (swap lo/hi)
  lo = (b2vLo[d]! ^ b2vLo[a]!) >>> 0
  hi = (b2vHi[d]! ^ b2vHi[a]!) >>> 0
  b2vLo[d] = hi
  b2vHi[d] = lo

  lo = b2vLo[c]! + b2vLo[d]!
  carry = lo > 0xffffffff ? 1 : 0
  b2vLo[c] = lo >>> 0
  b2vHi[c] = (b2vHi[c]! + b2vHi[d]! + carry) >>> 0

  // b ^= c, rotr 24
  lo = b2vLo[b]! ^ b2vLo[c]!
  hi = b2vHi[b]! ^ b2vHi[c]!
  b2vLo[b] = ((lo >>> 24) | (hi << 8)) >>> 0
  b2vHi[b] = ((hi >>> 24) | (lo << 8)) >>> 0

  lo = b2vLo[a]! + b2vLo[b]!
  carry = lo > 0xffffffff ? 1 : 0
  lo = (lo >>> 0) + b2mLo[yi]!
  if (lo > 0xffffffff) carry++
  hi = (b2vHi[a]! + b2vHi[b]! + b2mHi[yi]! + carry) >>> 0
  b2vLo[a] = lo >>> 0
  b2vHi[a] = hi

  // d ^= a, rotr 16
  lo = b2vLo[d]! ^ b2vLo[a]!
  hi = b2vHi[d]! ^ b2vHi[a]!
  b2vLo[d] = ((lo >>> 16) | (hi << 16)) >>> 0
  b2vHi[d] = ((hi >>> 16) | (lo << 16)) >>> 0

  lo = b2vLo[c]! + b2vLo[d]!
  carry = lo > 0xffffffff ? 1 : 0
  b2vLo[c] = lo >>> 0
  b2vHi[c] = (b2vHi[c]! + b2vHi[d]! + carry) >>> 0

  // b ^= c, rotr 63 (= rotl 1)
  lo = b2vLo[b]! ^ b2vLo[c]!
  hi = b2vHi[b]! ^ b2vHi[c]!
  b2vLo[b] = ((lo << 1) | (hi >>> 31)) >>> 0
  b2vHi[b] = ((hi << 1) | (lo >>> 31)) >>> 0
}

function blake2b(input: Uint8Array, outLen: number): Uint8Array {
  const hLo = new Uint32Array(BLAKE2B_IV_LO)
  const hHi = new Uint32Array(BLAKE2B_IV_HI)
  hLo[0] = (hLo[0]! ^ 0x01010000 ^ outLen) >>> 0

  const len = input.length
  const numBlocks = len === 0 ? 1 : Math.ceil(len / 128)
  const padded = new Uint8Array(numBlocks * 128)
  padded.set(input)
  const view = new DataView(padded.buffer)

  for (let blk = 0; blk < numBlocks; blk++) {
    const isLast = blk === numBlocks - 1
    const tBytes = isLast ? len : (blk + 1) * 128
    const tLo = tBytes >>> 0
    const tHi = Math.floor(tBytes / 0x100000000) >>> 0

    for (let i = 0; i < 8; i++) {
      b2vLo[i] = hLo[i]!
      b2vHi[i] = hHi[i]!
      b2vLo[i + 8] = BLAKE2B_IV_LO[i]!
      b2vHi[i + 8] = BLAKE2B_IV_HI[i]!
    }
    b2vLo[12] = (b2vLo[12]! ^ tLo) >>> 0
    b2vHi[12] = (b2vHi[12]! ^ tHi) >>> 0
    if (isLast) {
      b2vLo[14] = (b2vLo[14]! ^ 0xffffffff) >>> 0
      b2vHi[14] = (b2vHi[14]! ^ 0xffffffff) >>> 0
    }

    const base = blk * 128
    for (let i = 0; i < 16; i++) {
      b2mLo[i] = view.getUint32(base + i * 8, true)
      b2mHi[i] = view.getUint32(base + i * 8 + 4, true)
    }

    for (let r = 0; r < 12; r++) {
      const s = BLAKE2B_SIGMA[r]!
      b2G(0, 4, 8, 12, s[0]!, s[1]!)
      b2G(1, 5, 9, 13, s[2]!, s[3]!)
      b2G(2, 6, 10, 14, s[4]!, s[5]!)
      b2G(3, 7, 11, 15, s[6]!, s[7]!)
      b2G(0, 5, 10, 15, s[8]!, s[9]!)
      b2G(1, 6, 11, 12, s[10]!, s[11]!)
      b2G(2, 7, 8, 13, s[12]!, s[13]!)
      b2G(3, 4, 9, 14, s[14]!, s[15]!)
    }

    for (let i = 0; i < 8; i++) {
      hLo[i] = (hLo[i]! ^ b2vLo[i]! ^ b2vLo[i + 8]!) >>> 0
      hHi[i] = (hHi[i]! ^ b2vHi[i]! ^ b2vHi[i + 8]!) >>> 0
    }
  }

  const digest = new Uint8Array(64)
  const dView = new DataView(digest.buffer)
  for (let i = 0; i < 8; i++) {
    dView.setUint32(i * 8, hLo[i]!, true)
    dView.setUint32(i * 8 + 4, hHi[i]!, true)
  }
  return digest.slice(0, outLen)
}

function blake2bLong(input: Uint8Array, outLen: number): Uint8Array {
  const buf = new Uint8Array(4 + input.length)
  new DataView(buf.buffer).setUint32(0, outLen, true)
  buf.set(input, 4)

  if (outLen <= 64) {
    return blake2b(buf, outLen)
  }
  const out = new Uint8Array(outLen)
  let v = blake2b(buf, 64)
  out.set(v.subarray(0, 32), 0)
  let offset = 32
  let remaining = outLen - 32
  while (remaining > 64) {
    v = blake2b(v, 64)
    out.set(v.subarray(0, 32), offset)
    offset += 32
    remaining -= 32
  }
  out.set(blake2b(v, remaining), offset)
  return out
}

// 1024-byte block workspace = 256 u32 words (128 u64 words as interleaved [lo, hi])
const blockR = new Uint32Array(256)
const blockTmp = new Uint32Array(256)

function gb(arr: Uint32Array, a: number, b: number, c: number, d: number): void {
  const ai = a << 1
  const bi = b << 1
  const ci = c << 1
  const di = d << 1

  let aLo = arr[ai]!
  let aHi = arr[ai + 1]!
  let bLo = arr[bi]!
  let bHi = arr[bi + 1]!
  let cLo = arr[ci]!
  let cHi = arr[ci + 1]!
  let dLo = arr[di]!
  let dHi = arr[di + 1]!

  // fBlaMka(a, b) = a + b + 2 * lo32(a) * lo32(b)
  {
    const m = Math.imul(aLo & 0xffff, bLo & 0xffff)
    const albh = (aLo & 0xffff) * (bLo >>> 16)
    const ahbl = (aLo >>> 16) * (bLo & 0xffff)
    const ahbh = (aLo >>> 16) * (bLo >>> 16)
    const pLo = Math.imul(aLo, bLo) >>> 0
    const mid = (m >>> 16) + (albh & 0xffff) + (ahbl & 0xffff)
    const pHi = (ahbh + (albh >>> 16) + (ahbl >>> 16) + (mid >>> 16)) >>> 0
    const dProdLo = (pLo << 1) >>> 0
    const dProdHi = ((pHi << 1) | (pLo >>> 31)) >>> 0

    let sumLo = aLo + bLo
    let carry = sumLo > 0xffffffff ? 1 : 0
    sumLo = (sumLo >>> 0) + dProdLo
    if (sumLo > 0xffffffff) carry++
    aLo = sumLo >>> 0
    aHi = (aHi + bHi + dProdHi + carry) >>> 0
  }
  // d ^= a, rotr 32
  {
    const xLo = (dLo ^ aLo) >>> 0
    const xHi = (dHi ^ aHi) >>> 0
    dLo = xHi
    dHi = xLo
  }
  // fBlaMka(c, d)
  {
    const m = (cLo & 0xffff) * (dLo & 0xffff)
    const cldh = (cLo & 0xffff) * (dLo >>> 16)
    const chdl = (cLo >>> 16) * (dLo & 0xffff)
    const chdh = (cLo >>> 16) * (dLo >>> 16)
    const pLo = Math.imul(cLo, dLo) >>> 0
    const mid = (m >>> 16) + (cldh & 0xffff) + (chdl & 0xffff)
    const pHi = (chdh + (cldh >>> 16) + (chdl >>> 16) + (mid >>> 16)) >>> 0
    const dProdLo = (pLo << 1) >>> 0
    const dProdHi = ((pHi << 1) | (pLo >>> 31)) >>> 0

    let sumLo = cLo + dLo
    let carry = sumLo > 0xffffffff ? 1 : 0
    sumLo = (sumLo >>> 0) + dProdLo
    if (sumLo > 0xffffffff) carry++
    cLo = sumLo >>> 0
    cHi = (cHi + dHi + dProdHi + carry) >>> 0
  }
  // b ^= c, rotr 24
  {
    const xLo = bLo ^ cLo
    const xHi = bHi ^ cHi
    bLo = ((xLo >>> 24) | (xHi << 8)) >>> 0
    bHi = ((xHi >>> 24) | (xLo << 8)) >>> 0
  }
  // fBlaMka(a, b)
  {
    const m = (aLo & 0xffff) * (bLo & 0xffff)
    const albh = (aLo & 0xffff) * (bLo >>> 16)
    const ahbl = (aLo >>> 16) * (bLo & 0xffff)
    const ahbh = (aLo >>> 16) * (bLo >>> 16)
    const pLo = Math.imul(aLo, bLo) >>> 0
    const mid = (m >>> 16) + (albh & 0xffff) + (ahbl & 0xffff)
    const pHi = (ahbh + (albh >>> 16) + (ahbl >>> 16) + (mid >>> 16)) >>> 0
    const dProdLo = (pLo << 1) >>> 0
    const dProdHi = ((pHi << 1) | (pLo >>> 31)) >>> 0

    let sumLo = aLo + bLo
    let carry = sumLo > 0xffffffff ? 1 : 0
    sumLo = (sumLo >>> 0) + dProdLo
    if (sumLo > 0xffffffff) carry++
    aLo = sumLo >>> 0
    aHi = (aHi + bHi + dProdHi + carry) >>> 0
  }
  // d ^= a, rotr 16
  {
    const xLo = dLo ^ aLo
    const xHi = dHi ^ aHi
    dLo = ((xLo >>> 16) | (xHi << 16)) >>> 0
    dHi = ((xHi >>> 16) | (xLo << 16)) >>> 0
  }
  // fBlaMka(c, d)
  {
    const m = (cLo & 0xffff) * (dLo & 0xffff)
    const cldh = (cLo & 0xffff) * (dLo >>> 16)
    const chdl = (cLo >>> 16) * (dLo & 0xffff)
    const chdh = (cLo >>> 16) * (dLo >>> 16)
    const pLo = Math.imul(cLo, dLo) >>> 0
    const mid = (m >>> 16) + (cldh & 0xffff) + (chdl & 0xffff)
    const pHi = (chdh + (cldh >>> 16) + (chdl >>> 16) + (mid >>> 16)) >>> 0
    const dProdLo = (pLo << 1) >>> 0
    const dProdHi = ((pHi << 1) | (pLo >>> 31)) >>> 0

    let sumLo = cLo + dLo
    let carry = sumLo > 0xffffffff ? 1 : 0
    sumLo = (sumLo >>> 0) + dProdLo
    if (sumLo > 0xffffffff) carry++
    cLo = sumLo >>> 0
    cHi = (cHi + dHi + dProdHi + carry) >>> 0
  }
  // b ^= c, rotr 63 (= rotl 1)
  {
    const xLo = bLo ^ cLo
    const xHi = bHi ^ cHi
    bLo = ((xLo << 1) | (xHi >>> 31)) >>> 0
    bHi = ((xHi << 1) | (xLo >>> 31)) >>> 0
  }

  arr[ai] = aLo
  arr[ai + 1] = aHi
  arr[bi] = bLo
  arr[bi + 1] = bHi
  arr[ci] = cLo
  arr[ci + 1] = cHi
  arr[di] = dLo
  arr[di + 1] = dHi
}

function blake2RoundRow(arr: Uint32Array, row: number): void {
  const b = row * 16
  gb(arr, b + 0, b + 4, b + 8, b + 12)
  gb(arr, b + 1, b + 5, b + 9, b + 13)
  gb(arr, b + 2, b + 6, b + 10, b + 14)
  gb(arr, b + 3, b + 7, b + 11, b + 15)
  gb(arr, b + 0, b + 5, b + 10, b + 15)
  gb(arr, b + 1, b + 6, b + 11, b + 12)
  gb(arr, b + 2, b + 7, b + 8, b + 13)
  gb(arr, b + 3, b + 4, b + 9, b + 14)
}

function blake2RoundCol(arr: Uint32Array, col: number): void {
  const c = col * 2
  gb(arr, c + 0, c + 32, c + 64, c + 96)
  gb(arr, c + 1, c + 33, c + 65, c + 97)
  gb(arr, c + 16, c + 48, c + 80, c + 112)
  gb(arr, c + 17, c + 49, c + 81, c + 113)
  gb(arr, c + 0, c + 33, c + 80, c + 113)
  gb(arr, c + 1, c + 48, c + 81, c + 96)
  gb(arr, c + 16, c + 49, c + 64, c + 97)
  gb(arr, c + 17, c + 32, c + 65, c + 112)
}

function fillBlock(
  memory: Uint32Array,
  prevOffset: number,
  refOffset: number,
  currOffset: number,
  xorWithCurr: boolean
): void {
  for (let i = 0; i < 256; i++) {
    const rVal = memory[prevOffset + i]! ^ memory[refOffset + i]!
    blockR[i] = rVal
    blockTmp[i] = rVal
  }
  for (let r = 0; r < 8; r++) blake2RoundRow(blockTmp, r)
  for (let c = 0; c < 8; c++) blake2RoundCol(blockTmp, c)

  if (xorWithCurr) {
    for (let i = 0; i < 256; i++) {
      memory[currOffset + i] = memory[currOffset + i]! ^ blockTmp[i]! ^ blockR[i]!
    }
  } else {
    for (let i = 0; i < 256; i++) {
      memory[currOffset + i] = blockTmp[i]! ^ blockR[i]!
    }
  }
}

function mulHigh32(a: number, b: number): number {
  const aLo = a & 0xffff
  const aHi = a >>> 16
  const bLo = b & 0xffff
  const bHi = b >>> 16
  const mid = ((aLo * bLo) >>> 16) + ((aLo * bHi) & 0xffff) + ((aHi * bLo) & 0xffff)
  return (aHi * bHi + ((aLo * bHi) >>> 16) + ((aHi * bLo) >>> 16) + (mid >>> 16)) >>> 0
}

function fillAddressBlock(
  addrBlock: Uint32Array,
  pass: number,
  lane: number,
  slice: number,
  totalBlocks: number,
  passes: number,
  counter: number
): void {
  const input = new Uint32Array(256)
  input[0] = pass
  input[2] = lane
  input[4] = slice
  input[6] = totalBlocks
  input[8] = passes
  input[10] = 2 // Argon2id type = 2
  input[12] = counter

  // First G(0, input): T = 0 XOR input = input
  blockR.set(input)
  blockTmp.set(input)
  for (let r = 0; r < 8; r++) blake2RoundRow(blockTmp, r)
  for (let c = 0; c < 8; c++) blake2RoundCol(blockTmp, c)
  for (let i = 0; i < 256; i++) input[i] = blockTmp[i]! ^ blockR[i]!

  // Second G(0, T)
  blockR.set(input)
  blockTmp.set(input)
  for (let r = 0; r < 8; r++) blake2RoundRow(blockTmp, r)
  for (let c = 0; c < 8; c++) blake2RoundCol(blockTmp, c)
  for (let i = 0; i < 256; i++) addrBlock[i] = blockTmp[i]! ^ blockR[i]!
}

export function argon2idSync(params: {
  password: Uint8Array
  salt: Uint8Array
  memoryKiB: number
  passes: number
  parallelism: number
  tagLength: number
}): Uint8Array {
  const { password, salt, memoryKiB, passes, parallelism, tagLength } = params
  const laneLength = Math.floor(memoryKiB / (4 * parallelism)) * 4
  const segmentLength = laneLength / 4
  const totalBlocks = laneLength * parallelism

  // H0 = BLAKE2b_64(LE32(p, tau, m, t, 0x13, y=2, len(P)), P, LE32(len(S)), S, 0, 0)
  const h0Input = new Uint8Array(40 + password.length + salt.length)
  const dv = new DataView(h0Input.buffer)
  dv.setUint32(0, parallelism, true)
  dv.setUint32(4, tagLength, true)
  dv.setUint32(8, memoryKiB, true)
  dv.setUint32(12, passes, true)
  dv.setUint32(16, 0x13, true)
  dv.setUint32(20, 2, true)
  dv.setUint32(24, password.length, true)
  h0Input.set(password, 28)
  dv.setUint32(28 + password.length, salt.length, true)
  h0Input.set(salt, 32 + password.length)
  dv.setUint32(32 + password.length + salt.length, 0, true)
  dv.setUint32(36 + password.length + salt.length, 0, true)
  const h0 = blake2b(h0Input, 64)

  const memory = new Uint32Array(totalBlocks * 256)
  const seedBuf = new Uint8Array(72)
  seedBuf.set(h0, 0)
  const seedView = new DataView(seedBuf.buffer)

  try {
    for (let lane = 0; lane < parallelism; lane++) {
      seedView.setUint32(68, lane, true)
      seedView.setUint32(64, 0, true)
      const b0 = blake2bLong(seedBuf, 1024)
      memory.set(new Uint32Array(b0.buffer, b0.byteOffset, 256), lane * laneLength * 256)

      seedView.setUint32(64, 1, true)
      const b1 = blake2bLong(seedBuf, 1024)
      memory.set(new Uint32Array(b1.buffer, b1.byteOffset, 256), (lane * laneLength + 1) * 256)
    }

    const addrBlock = new Uint32Array(256)
    for (let pass = 0; pass < passes; pass++) {
      for (let slice = 0; slice < 4; slice++) {
        for (let lane = 0; lane < parallelism; lane++) {
          const dataIndependent = pass === 0 && slice < 2
          let addrCounter = 0
          let addrIndex = 128
          const startIndex = pass === 0 && slice === 0 ? 2 : 0
          if (dataIndependent && startIndex > 0) {
            addrCounter = 1
            fillAddressBlock(addrBlock, pass, lane, slice, totalBlocks, passes, addrCounter)
            addrIndex = startIndex
          }

          for (let index = startIndex; index < segmentLength; index++) {
            const currIdx = slice * segmentLength + index
            const prevIdx = currIdx === 0 ? laneLength - 1 : currIdx - 1
            const prevOff = (lane * laneLength + prevIdx) * 256
            const currOff = (lane * laneLength + currIdx) * 256

            let j1: number
            let j2: number
            if (dataIndependent) {
              if (addrIndex >= 128) {
                addrCounter++
                fillAddressBlock(addrBlock, pass, lane, slice, totalBlocks, passes, addrCounter)
                addrIndex = 0
              }
              j1 = addrBlock[addrIndex * 2]!
              j2 = addrBlock[addrIndex * 2 + 1]!
              addrIndex++
            } else {
              j1 = memory[prevOff]!
              j2 = memory[prevOff + 1]!
            }

            const refLane = pass === 0 && slice === 0 ? lane : j2 % parallelism
            const sameLane = refLane === lane
            const refAreaSize = sameLane
              ? pass === 0
                ? slice * segmentLength + index - 1
                : laneLength - segmentLength + index - 1
              : pass === 0
                ? slice * segmentLength - (index === 0 ? 1 : 0)
                : laneLength - segmentLength - (index === 0 ? 1 : 0)

            const x = mulHigh32(j1, j1)
            const y = mulHigh32(refAreaSize, x)
            const relPos = refAreaSize - 1 - y
            const startPos = pass === 0 || slice === 3 ? 0 : (slice + 1) * segmentLength
            const refIdx = (startPos + relPos) % laneLength
            const refOff = (refLane * laneLength + refIdx) * 256

            fillBlock(memory, prevOff, refOff, currOff, pass > 0)
          }
        }
      }
    }

    const finalBlockWords = new Uint32Array(256)
    for (let lane = 0; lane < parallelism; lane++) {
      const lastOff = (lane * laneLength + laneLength - 1) * 256
      for (let i = 0; i < 256; i++) finalBlockWords[i] = (finalBlockWords[i]! ^ memory[lastOff + i]!) >>> 0
    }
    const finalBytes = new Uint8Array(finalBlockWords.buffer)
    return blake2bLong(finalBytes, tagLength)
  } finally {
    memory.fill(0)
    h0Input.fill(0)
    h0.fill(0)
    seedBuf.fill(0)
    blockR.fill(0)
    blockTmp.fill(0)
  }
}
