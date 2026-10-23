using System;
using System.Buffers.Binary;
using System.Text;

namespace Magnate.Bridge;

/// <summary>
/// Minimal managed SHA-256 (FIPS 180-4) for the content hash and game ids.
/// Kept in-house so the browser build does not pull
/// System.Security.Cryptography into the WASM bundle for two hashes per session.
/// </summary>
internal sealed class Sha256
{
    private static readonly uint[] K =
    {
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    };

    private readonly uint[] _h = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
    private readonly byte[] _block = new byte[64];
    private readonly uint[] _w = new uint[64];
    private int _blockLength;
    private long _totalBytes;

    public void Append(ReadOnlySpan<byte> data)
    {
        _totalBytes += data.Length;
        while (data.Length > 0)
        {
            var take = Math.Min(64 - _blockLength, data.Length);
            data[..take].CopyTo(_block.AsSpan(_blockLength));
            _blockLength += take;
            data = data[take..];
            if (_blockLength == 64)
            {
                Compress();
                _blockLength = 0;
            }
        }
    }

    public void Append(string text) => Append(Encoding.UTF8.GetBytes(text));

    public byte[] Finish()
    {
        var bitLength = (ulong)_totalBytes * 8;
        _block[_blockLength++] = 0x80;
        if (_blockLength > 56)
        {
            Array.Clear(_block, _blockLength, 64 - _blockLength);
            Compress();
            _blockLength = 0;
        }
        Array.Clear(_block, _blockLength, 56 - _blockLength);
        BinaryPrimitives.WriteUInt64BigEndian(_block.AsSpan(56), bitLength);
        Compress();
        var digest = new byte[32];
        for (var i = 0; i < 8; i++) BinaryPrimitives.WriteUInt32BigEndian(digest.AsSpan(i * 4), _h[i]);
        return digest;
    }

    public static string Hex(byte[] digest)
    {
        var sb = new StringBuilder(digest.Length * 2);
        foreach (var b in digest) sb.Append(b.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
        return sb.ToString();
    }

    public static string HexOf(string text)
    {
        var sha = new Sha256();
        sha.Append(text);
        return Hex(sha.Finish());
    }

    private void Compress()
    {
        for (var i = 0; i < 16; i++) _w[i] = BinaryPrimitives.ReadUInt32BigEndian(_block.AsSpan(i * 4));
        for (var i = 16; i < 64; i++)
        {
            var s0 = Rotr(_w[i - 15], 7) ^ Rotr(_w[i - 15], 18) ^ (_w[i - 15] >> 3);
            var s1 = Rotr(_w[i - 2], 17) ^ Rotr(_w[i - 2], 19) ^ (_w[i - 2] >> 10);
            _w[i] = unchecked(_w[i - 16] + s0 + _w[i - 7] + s1);
        }
        uint a = _h[0], b = _h[1], c = _h[2], d = _h[3], e = _h[4], f = _h[5], g = _h[6], h = _h[7];
        for (var i = 0; i < 64; i++)
        {
            var s1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
            var ch = (e & f) ^ (~e & g);
            var t1 = unchecked(h + s1 + ch + K[i] + _w[i]);
            var s0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = unchecked(s0 + maj);
            h = g;
            g = f;
            f = e;
            e = unchecked(d + t1);
            d = c;
            c = b;
            b = a;
            a = unchecked(t1 + t2);
        }
        unchecked
        {
            _h[0] += a; _h[1] += b; _h[2] += c; _h[3] += d; _h[4] += e; _h[5] += f; _h[6] += g; _h[7] += h;
        }
    }

    private static uint Rotr(uint x, int n) => (x >> n) | (x << (32 - n));
}
