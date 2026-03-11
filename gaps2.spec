# -*- mode: python ; coding: utf-8 -*-
import os

block_cipher = None
root = os.path.abspath('.')

a = Analysis(
    ['backend/run.py'],
    pathex=[os.path.join(root, 'backend')],
    binaries=[],
    datas=[
        (os.path.join(root, 'frontend', 'dist', 'gaps-2'), os.path.join('frontend', 'dist', 'gaps-2')),
    ],
    hiddenimports=[
        'app',
        'app.config',
        'app.blueprints',
        'app.blueprints.plex',
        'app.blueprints.tmdb',
        'app.blueprints.libraries',
        'app.blueprints.recommendations',
        'app.blueprints.schedule',
        'app.blueprints.notifications',
        'app.services',
        'app.services.config_store',
        'app.services.plex_service',
        'app.services.tmdb_service',
        'app.services.schedule_service',
        'app.services.notification_service',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='GAPS-2',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    icon=os.path.join(root, 'frontend', 'src', 'assets', 'images', 'gaps.ico'),
)
