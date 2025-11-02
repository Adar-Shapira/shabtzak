# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ['uvicorn', 'app.main', 'app.db', 'app.models', 'app.models.assignment', 'app.models.base', 'app.models.department', 'app.models.mission', 'app.models.mission_requirement', 'app.models.mission_slot', 'app.models.role', 'app.models.saved_plan', 'app.models.soldier', 'app.models.soldier_mission_restriction', 'app.models.soldier_role', 'app.models.vacation', 'app.routers', 'app.routers.assignments', 'app.routers.departments', 'app.routers.mission_history', 'app.routers.mission_requirements', 'app.routers.missions', 'app.routers.planning', 'app.routers.roles', 'app.routers.saved_plans', 'app.routers.soldiers', 'app.routers.soldiers_patch', 'app.routers.vacations', 'app.routers.warnings', 'app.schemas', 'sqlalchemy.dialects.sqlite']
tmp_ret = collect_all('uvicorn')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['start.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='api-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
