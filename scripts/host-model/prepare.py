"""Turn the Tripo host GLB into the rigged, masked asset the tea room loads.

    blender -b --factory-startup -P scripts/host-model/prepare.py -- \
        <tripo.glb> <out.glb> [debugDir]

Steps: face the model down -Y (glTF +Z), scale it to the diorama's 1.95 m,
add an upper-body skeleton with automatic weights, make the cup and teapot
rigid in the hands, keep the beard, hair and hat on the head, write a
per-corner region mask (_MASK: skin, hair, cloth, straw), copy the hair faces
into their own mesh for fur shells, store the painted eyes' UV frames as
extras, and export a skinned GLB. With debugDir it also renders rest and
test-pose views for review.

Joint and eye positions are hand-picked from orthographic renders of the
seed-11 Tripo model; a new model needs new values.
"""

import bmesh
import bpy
import colorsys
import json
import math
import sys

import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
DEBUG = argv[2] if len(argv) > 2 else None

HEIGHT = 1.95
# Blender axes after normalizing: +X his left, -Y his front, +Z up.
J = {
    'pelvis': (0, 0.15, 0.45), 'spine': (0, 0.15, 0.75), 'chest': (0, 0.16, 1.0),
    'neck': (-0.02, 0.14, 1.18), 'head': (-0.04, 0.08, 1.33), 'top': (-0.04, 0.02, 1.7),
    'clav_R': (-0.08, 0.16, 1.12), 'shoulder_R': (-0.38, 0.16, 1.05),
    'elbow_R': (-0.45, -0.06, 0.62), 'wrist_R': (-0.28, -0.36, 0.8), 'hand_R': (-0.17, -0.45, 0.85),
    'clav_L': (0.08, 0.16, 1.12), 'shoulder_L': (0.38, 0.16, 1.05),
    'elbow_L': (0.5, 0.03, 0.68), 'wrist_L': (0.55, -0.24, 0.69), 'hand_L': (0.56, -0.33, 0.67),
    'mouth': (-0.07, -0.2, 1.37), 'cup': (-0.135, -0.44, 1.0), 'spout': (0.2, -0.437, 0.666),
}
# Axis-aligned boxes (min, max) that move rigidly with a hand: hand plus prop.
RIGID = {
    'hand_R': ((-0.3, -0.6, 0.72), (-0.02, -0.34, 1.06)),
    'hand_L': ((0.15, -0.53, 0.55), (0.7, -0.26, 0.8)),
}
# Painted eye centres (x, z) from a front orthographic render; the opening
# itself is fitted from the texture (fit_eye).
EYES = {'R': {'center': (-0.1426, 1.5046)}, 'L': {'center': (0.0282, 1.5244)}}
EYE_COLUMNS = 16  # matches EYE_COLUMNS in src/scene/IrohModel.tsx


def log(*args):
    print('[prepare]', *args, flush=True)


def normalize():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    for o in list(bpy.context.scene.objects):
        if o is not ob and o.type == 'EMPTY':
            bpy.data.objects.remove(o)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # The importer uses quaternions; Tripo faces +X, the room wants -Y.
    ob.rotation_mode = 'XYZ'
    ob.rotation_euler = (0, 0, -math.pi / 2)
    bpy.ops.object.transform_apply(rotation=True)
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    mn, mx = co.min(0), co.max(0)
    s = HEIGHT / (mx[2] - mn[2])
    ob.data.transform(
        Matrix.Diagonal((s, s, s, 1.0))
        @ Matrix.Translation((-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]))
    )
    ob.name = ob.data.name = 'IrohBody'
    # Weld UV-seam splits so each seam gets one weight; UVs live on corners.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(ob.data)
    bm.free()
    log('verts', len(ob.data.vertices), 'faces', len(ob.data.polygons))
    return ob


def base_image(ob):
    for node in ob.active_material.node_tree.nodes:
        if node.type == 'BSDF_PRINCIPLED':
            return node.inputs['Base Color'].links[0].from_node.image
    raise RuntimeError('no base colour image')


def image_pixels(image):
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    return px.reshape(h, w, 4), w, h


def corner_data(ob):
    """Per-corner UV, colour (sRGB) and position."""
    me = ob.data
    n = len(me.loops)
    uv = np.empty(n * 2)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    vi = np.empty(n, dtype=np.int64)
    me.loops.foreach_get('vertex_index', vi)
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)[vi]
    px, w, h = image_pixels(base_image(ob))
    x = np.clip((uv[:, 0] % 1.0) * (w - 1), 0, w - 1).astype(np.int64)
    y = np.clip((uv[:, 1] % 1.0) * (h - 1), 0, h - 1).astype(np.int64)
    rgb = px[y, x, :3]
    return uv, vi, co, rgb


def classify(co, rgb):
    """Soft region weights per corner: skin, hair, cloth, straw."""
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in rgb])
    hue, sat, val = hsv[:, 0] * 360, hsv[:, 1], hsv[:, 2]
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    # Painted eye whites are pale too; keep fur shells off the eyes.
    eye_zone = np.zeros(len(co), bool)
    for eye in EYES.values():
        ex, ez = eye['center']
        eye_zone |= (np.abs(x - ex) < 0.07) & (np.abs(z - ez) < 0.04) & (y < 0)
    hair = (sat < 0.16) & (val > 0.55) & (z > 1.05) & ~eye_zone
    straw = (~hair) & (z > 1.5) & (hue > 18) & (hue < 50) & (sat > 0.3)
    skin_tone = (hue > 6) & (hue < 36) & (sat > 0.2) & (sat < 0.72) & (val > 0.3)
    in_box = np.zeros(len(co), bool)
    for lo, hi in RIGID.values():
        in_box |= np.all((co >= lo) & (co <= hi), axis=1)
    face_zone = (z > 1.22) & (y < 0.12)
    feet = (z < 0.22) & (y < -0.35)
    skin = skin_tone & (~hair) & (~straw) & (face_zone | in_box | feet)
    prop = in_box & (~skin)
    cloth = ~(hair | straw | skin | prop)
    return np.stack([skin, hair, cloth, straw], 1).astype(np.float32)


def write_mask(ob, mask):
    attr = ob.data.color_attributes.new('_MASK', 'FLOAT_COLOR', 'CORNER')
    attr.data.foreach_set('color', mask.ravel())


def eye_frames(ob):
    """UV centre and the UV->plane matrix of each painted eye opening."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    me = ob.data
    uvl = me.uv_layers.active.data

    def uv_at(x, z):
        hit, loc, _n, fi, _o, _m = bpy.context.scene.ray_cast(
            depsgraph, Vector((x, -3.0, z)), Vector((0, 1, 0))
        )
        assert hit, (x, z)
        poly = me.polygons[fi]
        pts = [me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices]
        uvs = [Vector(uvl[li].uv) for li in poly.loop_indices]
        # Barycentric weights on the (triangulated) face.
        a, b, c = pts[0], pts[1], pts[2]
        v0, v1, v2 = b - a, c - a, loc - a
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        return uvs[0] * (1 - wb - wc) + uvs[1] * wb + uvs[2] * wc, loc

    # ponytail: an affine frame from 1 cm finite differences; fine while no UV
    # seam crosses an eye (check the host-face shot after a new model).

    (rx, rz), (lx, lz) = EYES['R']['center'], EYES['L']['center']
    roll = math.atan2(lz - rz, lx - rx)
    ex = Vector((math.cos(roll), math.sin(roll)))
    ez = Vector((-math.sin(roll), math.cos(roll)))
    px, w, h = image_pixels(base_image(ob))
    frames = {}
    for side, eye in EYES.items():
        cx, cz = eye['center']
        d = 0.01
        c = np.array(uv_at(cx, cz)[0])
        u = (np.array(uv_at(cx + ex.x * d, cz + ex.y * d)[0]) - c) / d
        v = (np.array(uv_at(cx + ez.x * d, cz + ez.y * d)[0]) - c) / d
        m = np.stack([u, v], 1)
        center, shape = fit_eye(px, w, h, c, m, eye, side)
        c = c + m @ center
        # glTF flips V, so flip the V row and the centre to match three's uv.
        m = np.diag([1, -1]) @ m
        frames[side] = {
            'uv': [c[0], 1 - c[1]],
            # Column-major mat2s for GLSL: uv offset -> eye plane (m) and back.
            'toPlane': np.linalg.inv(m).T.ravel().tolist(),
            'toUv': m.T.ravel().tolist(),
            **shape,
        }
    return frames


def fit_eye(px, w, h, c, m, eye, side):
    """Fit the opening to the painted eye: the non-skin blob around the centre."""
    step = 0.0005
    xs = np.arange(-0.07, 0.07, step)
    ys = np.arange(-0.035, 0.035, step)
    gx, gy = np.meshgrid(xs, ys)
    uv = c[None, None] + np.einsum('ij,yxj->yxi', m, np.stack([gx, gy], -1))
    tx = np.clip((uv[..., 0] % 1) * (w - 1), 0, w - 1).astype(int)
    ty = np.clip((uv[..., 1] % 1) * (h - 1), 0, h - 1).astype(int)
    rgb = px[ty, tx, :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    red_hue = (rgb[..., 0] >= rgb[..., 1]) & (rgb[..., 1] >= rgb[..., 2])
    skin = red_hue & (sat > 0.3) & (mx > 0.3)
    blob = np.zeros_like(skin)
    stack = [(len(ys) // 2, len(xs) // 2)]
    while stack:
        j, i = stack.pop()
        if 0 <= j < len(ys) and 0 <= i < len(xs) and not skin[j, i] and not blob[j, i]:
            blob[j, i] = True
            stack += [(j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)]
    bx, by = gx[blob], gy[blob]
    x0, x1 = np.percentile(bx, [1, 99])
    mid = (x0 + x1) / 2
    # Lid heights at 16 columns across the opening, closed at both corners.
    top, bottom = [], []
    for xc in np.linspace(x0, x1, EYE_COLUMNS):
        col = by[np.abs(bx - xc) < (x1 - x0) / EYE_COLUMNS]
        top.append(float(np.percentile(col, 97)) if col.size else 0.0)
        bottom.append(float(np.percentile(col, 3)) if col.size else 0.0)
    for k in (0, -1):
        top[k] = bottom[k] = (top[k] + bottom[k]) / 2
    shape = {'width': float((x1 - x0) / 2), 'top': top, 'bottom': bottom}
    log(f'eye {side}: centre shift {mid:.4f}, half width {shape["width"]:.4f},',
        f'lids {max(top):.4f}/{min(bottom):.4f}, measured', eye, 'blob', int(blob.sum()))
    if DEBUG:
        img = bpy.data.images.new(f'eye-{side}', len(xs), len(ys))
        view = np.dstack([rgb * 0.6 + blob[..., None] * 0.4, np.ones(skin.shape)])
        img.pixels.foreach_set(view.astype(np.float32).ravel())
        img.save(filepath=f'{DEBUG}/eye-{side}.png')
    return np.array([mid, 0.0]), shape


def build_rig(ob):
    data = bpy.data.armatures.new('IrohRig')
    arm = bpy.data.objects.new('IrohRig', data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')

    def bone(name, head, tail, parent=None, deform=True):
        b = data.edit_bones.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        if parent:
            b.parent = data.edit_bones[parent]
        b.use_deform = deform

    bone('root', J['pelvis'], J['spine'])
    bone('spine', J['spine'], J['chest'], 'root')
    bone('chest', J['chest'], J['neck'], 'spine')
    bone('neck', J['neck'], J['head'], 'chest')
    bone('head', J['head'], J['top'], 'neck')
    for s in 'RL':
        bone(f'shoulder_{s}', J[f'clav_{s}'], J[f'shoulder_{s}'], 'chest')
        bone(f'upperarm_{s}', J[f'shoulder_{s}'], J[f'elbow_{s}'], f'shoulder_{s}')
        bone(f'forearm_{s}', J[f'elbow_{s}'], J[f'wrist_{s}'], f'upperarm_{s}')
        bone(f'hand_{s}', J[f'wrist_{s}'], J[f'hand_{s}'], f'forearm_{s}')
    up = Vector((0, 0, 0.04))
    bone('mouth', J['mouth'], Vector(J['mouth']) + up, 'head', deform=False)
    bone('cup', J['cup'], Vector(J['cup']) + up, 'hand_R', deform=False)
    bone('spout', J['spout'], Vector(J['spout']) + up, 'hand_L', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    return arm


def fix_weights(ob, mask):
    """Rigid props, head-bound hair and hat, a still lap."""
    me = ob.data
    groups = {g.name: g for g in ob.vertex_groups}
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    # Per-vertex region: any corner that is hair or straw.
    vi = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', vi)
    headish = np.zeros(len(me.vertices), bool)
    np.logical_or.at(headish, vi, (mask[:, 1] + mask[:, 3]) > 0.5)

    names = [g.name for g in ob.vertex_groups]
    w = np.zeros((len(me.vertices), len(names)))
    for v in me.vertices:
        for g in v.groups:
            w[v.index, g.group] = g.weight
    col = {n: k for k, n in enumerate(names)}
    log('unweighted verts before fix', int((w.sum(1) < 1e-3).sum()))

    def blend(sel, t, bone):
        """Move weight share t of the selected verts onto bone."""
        t = t[sel, None] if np.ndim(t) else t
        target = np.zeros(len(names))
        target[col[bone]] = 1
        w[sel] = w[sel] * (1 - t) + target * t

    def ramp(v, a, b):
        return np.clip((v - a) / (b - a), 0, 1)

    x, y, z = co.T
    w[w.sum(1) < 1e-3, col['spine']] = 1
    # Lap, knees and the robe's skirt stay put under the forearms.
    blend(np.ones(len(co), bool), ramp(z, 0.5, 0.38), 'root')
    # Neck to head, then everything hair, hat or high enough rides the head.
    neck = (np.abs(x) < 0.3) & (y < 0.3)
    blend(neck, ramp(z, 1.2, 1.34), 'head')
    blend(headish & (z > 1.05) & (y < 0.3), 1.0, 'head')
    # Hands and props are rigid, easing in over the last 2 cm of each box.
    for hand, (lo, hi) in RIGID.items():
        lo, hi = np.array(lo), np.array(hi)
        inside = np.min(np.minimum(co - lo, hi - co), axis=1)
        blend(inside > 0, ramp(inside, 0, 0.02), hand)
    w /= w.sum(1, keepdims=True)
    for k, g in enumerate(ob.vertex_groups):
        g.remove(range(len(me.vertices)))
        for i in np.nonzero(w[:, k] > 1e-3)[0].tolist():
            g.add([i], float(w[i, k]), 'REPLACE')


def extract_hair(ob, mask):
    """Copy hair faces into IrohHair for fur shells (keeps weights and UVs)."""
    me = ob.data
    starts = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_start', starts)
    counts = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', counts)
    # Any hair corner: the shell shader fades out on skin texels, so the fur
    # edge follows the paint instead of triangle edges.
    hair = np.maximum.reduceat(mask[:, 1], starts) > 0.5
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    me.polygons.foreach_set('select', hair)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.duplicate()
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    shell = [o for o in bpy.context.selected_objects if o is not ob][0]
    shell.name = shell.data.name = 'IrohHair'
    log('hair faces', int(hair.sum()))
    return shell


def debug_renders(arm):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.world = bpy.data.worlds.new('w')
    scene.world.color = (0.5, 0.5, 0.5)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.1
    scene.camera = cam

    def shot(name):
        for view, loc, rot in (
            ('front', (0, -5, 1.0), (math.pi / 2, 0, 0)),
            ('right', (-5, 0, 1.0), (math.pi / 2, 0, -math.pi / 2)),
        ):
            cam.location, cam.rotation_euler = loc, rot
            scene.render.filepath = f'{DEBUG}/{name}-{view}.png'
            bpy.ops.render.render(write_still=True)

    shot('rest')
    pb = arm.pose.bones
    for b in pb:
        b.rotation_mode = 'XYZ'
    # Sip: right arm raises the cup; pour: left arm lifts the pot; head turns.
    pb['upperarm_R'].rotation_euler = (math.radians(-35), 0, 0)
    pb['forearm_R'].rotation_euler = (math.radians(-40), 0, 0)
    pb['upperarm_L'].rotation_euler = (math.radians(-30), 0, math.radians(15))
    pb['head'].rotation_euler = (math.radians(10), math.radians(-15), 0)
    bpy.context.view_layer.update()
    shot('pose')
    for b in pb:
        b.rotation_euler = (0, 0, 0)


ob = normalize()
uv, vi, co, rgb = corner_data(ob)
mask = classify(co, rgb)
log('mask share skin/hair/cloth/straw', (mask.mean(0) * 100).round(1).tolist())
write_mask(ob, mask)
frames = eye_frames(ob)
ob['irohEyes'] = json.dumps(frames)
log('eyes', json.dumps(frames))
arm = build_rig(ob)
fix_weights(ob, mask)
hair = extract_hair(ob, mask)
if DEBUG:
    debug_renders(arm)
    bpy.ops.wm.save_as_mainfile(filepath=f'{DEBUG}/prepared.blend')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_skins=True,
    export_animations=False,
    export_attributes=True,
    export_vertex_color='NONE',
    export_all_vertex_colors=False,
    export_extras=True,
    export_yup=True,
    export_def_bones=False,
    export_apply=False,
)
log('exported', OUT)
