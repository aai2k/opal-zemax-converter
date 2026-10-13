# OPJ format

Little-endian, text in CP866. `file := { u32 nwords; u16 payload[nwords] }+`. Record 1 is the main
block; its words `w0..w3` are flags, and each further record exists only if its bit is set, in this
order: `w0` 4000 aspheres, 2000 clear semi-apertures, 1000 beams, 0800 obscuration, 0400 spectral,
0200, 0100; `w1` 8000 4000 2000 0400 0200 1000 (zoom); `w0` 0040, 0080; `w1` 0800; `w3` 8000;
`w2` 8000. Only the first five are decoded.

Main block:

| offset | type | |
|---|---|---|
| 0x00 | u16[4] | flags |
| 0x08 | char[40] | name |
| 0x30 | i16[12] | NSS, NLA, NGL, ND (99 = entrance pupil), OB, IM, KINDO, KINDI, SI-from-last, aperture type (−1 front, 1 back, 0 stop height), field-in-image, catalog mode (0 Russian, 7 international) |
| 0x48 | f64[9] | S0, SI, aperture x/y, SD, field x/y (rad at infinity, else mm), object and image curvature |
| 0x90 | f32[2] | ? |
| 0x98 | f32[NLA] | wavelengths, µm |
| | f64[NSS] ×2 | curvatures, thicknesses |
| | i16[NSS+1] | medium after each surface (1-based glass index, negative after a reflection) |
| | f64[NGL][min(NLA,5)] | indices |
| | char[NGL][8] | glass names: catalog letter + right-aligned name |
| | u16 | padding |

Asphere block: `i32; i16 order[NSS]; i16 aux[NSS]; f32 coef[100]`, packed per surface as `[e²]`
(order ±2), `[e², HA, a2…]` (U, order > 0) or `[e², HA, b3…]` (Z, order < 0). Surface:
`z − c(u + (1−e²)z²)/2 − Q = 0`, U: `Q = Σ a_j (u/HA²)^j`, Z: `Q = Σ b_j (z/HA)^j`.

Beams: `i32 n; f32 rel[n]; f32 (VB,VH)[n]; f64 S0[n], SI[n], SD[n]`. VB cuts the stop on the side
away from the object point: `VB = VCY + s·VDY`, `VH = VCY − s·VDY`, s = side of the object (+1 above).

Semi-apertures: `f32[NSS]`. Spectral: `f32 λmin, λmax, weight[10]`. Obscuration: `i32 NE; f32 EK; …`.
