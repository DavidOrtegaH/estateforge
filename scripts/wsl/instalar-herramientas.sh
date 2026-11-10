#!/bin/bash
# Herramientas de EstateForge en WSL, en espacio de usuario (sin root) y con verificación criptográfica:
#   Node.js 24.19.0: firma GPG de SHASUMS256.txt (clave de un publicador de nodejs/release-keys) y SHA-256.
#   pnpm 11.20.0: integridad sha512 del registro npm.
#   PostgreSQL 17 (PGDG): huella de la clave B97B0AFC...ACCC4CF8, firma de InRelease, SHA-256 del índice y de cada .deb.
#   Bibliotecas que falten: archivo de Ubuntu, firmado con ubuntu-archive-keyring.
# Destino: ~/.local/ef-tools (registro en verificacion.txt). Uso: bash scripts/wsl/instalar-herramientas.sh
# Destino: ~/.local/ef-tools. Llavero GPG propio en ~/.local/ef-tools/gnupg.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C LANG=C LANGUAGE=C
B=$HOME/.local/ef-tools
DL=$B/dl
mkdir -p "$DL" "$B/gnupg"
chmod 700 "$B/gnupg"
export GNUPGHOME=$B/gnupg
LOG=$B/verificacion.txt
: > "$LOG"
say() { echo "$*" | tee -a "$LOG"; }

# ---------------------------------------------------------------- Node.js
NODEV=v24.19.0
NODEF=node-$NODEV-linux-x64.tar.xz
cd "$DL"
curl -fsSL --max-time 300 -o SHASUMS256.txt.asc "https://nodejs.org/dist/$NODEV/SHASUMS256.txt.asc"
[ -f "$NODEF" ] || curl -fsSL --max-time 600 -o "$NODEF" "https://nodejs.org/dist/$NODEV/$NODEF"
FPR=$(gpg --batch --verify SHASUMS256.txt.asc 2>&1 | sed -n 's/.*using [A-Z]* key \([0-9A-F]*\).*/\1/p' | head -1 || true)
say "node: firma de SHASUMS256 hecha con la clave $FPR"
curl -fsSL --max-time 60 -o "node-$FPR.asc" "https://raw.githubusercontent.com/nodejs/release-keys/HEAD/keys/$FPR.asc"
gpg --batch --quiet --import "node-$FPR.asc"
gpg --batch --status-fd 1 --verify SHASUMS256.txt.asc 2>/dev/null | grep -E '^\[GNUPG:\] (GOODSIG|VALIDSIG)' | cut -c1-80 | tee -a "$LOG"
gpg --batch --verify SHASUMS256.txt.asc 2>/dev/null
gpg --batch --decrypt SHASUMS256.txt.asc 2>/dev/null | grep " $NODEF\$" > node.sha256
sha256sum -c node.sha256 | tee -a "$LOG"
rm -rf "$B/node" && mkdir -p "$B/node" && tar -xJf "$NODEF" -C "$B/node" --strip-components=1
say "node instalado: $("$B/node/bin/node" --version)"
export PATH=$B/node/bin:$PATH
npm config set prefix "$B/node" >/dev/null
npm install -g --no-fund --no-audit pnpm@11.20.0 >/dev/null
say "pnpm instalado: $("$B/node/bin/pnpm" --version) (npm verifica la integridad sha512 del registro)"

# ---------------------------------------------------------------- PostgreSQL 17 (PGDG)
PGFPR=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
curl -fsSL --max-time 60 -o pgdg.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
GOT=$(gpg --batch --with-colons --show-keys pgdg.asc | awk -F: '/^fpr/{print $10; exit}')
[ "$GOT" = "$PGFPR" ] || { say "huella PGDG inesperada: $GOT"; exit 1; }
gpg --batch --yes --dearmor -o pgdg.gpg pgdg.asc
say "pgdg: huella de la clave $GOT (esperada $PGFPR)"
fetch_index() { # $1 base url, $2 dist, $3 keyring, $4 prefijo
  curl -fsSL --max-time 120 -o "$4.InRelease" "$1/dists/$2/InRelease"
  gpgv --keyring "$3" "$4.InRelease" 2>&1 | grep -E 'Good signature|Firma correcta' | tee -a "$LOG"
  gpgv --keyring "$3" "$4.InRelease" >/dev/null 2>&1
  local sum ext
  for ext in xz gz bz2; do
    sum=$(awk -v n="main/binary-amd64/Packages.$ext" '/^SHA256:/{f=1;next} /^[A-Z]/{f=0} f && $3==n{print $1}' "$4.InRelease")
    [ -n "$sum" ] && break
  done
  curl -fsSL --max-time 300 -o "$4.Packages.$ext" "$1/dists/$2/main/binary-amd64/Packages.$ext"
  echo "$sum  $4.Packages.$ext" | sha256sum -c | tee -a "$LOG"
  case $ext in xz) xz -dc "$4.Packages.$ext" ;; gz) gzip -dc "$4.Packages.$ext" ;; bz2) bzip2 -dc "$4.Packages.$ext" ;; esac > "$4.Packages"
}
deb_get() { # $1 base url, $2 indice, $3 paquete -> descarga y verifica, imprime el archivo
  python3 - "$2" "$3" <<'PY' > deb.info
import sys
best = None
for block in open(sys.argv[1], encoding='utf-8', errors='replace').read().split('\n\n'):
    f = {}
    for line in block.split('\n'):
        if ': ' in line and not line.startswith(' '):
            k, v = line.split(': ', 1)
            f[k] = v
    if f.get('Package') == sys.argv[2] and f.get('Architecture') in ('amd64', 'all'):
        if best is None:
            best = f  # el indice lista primero la version mas reciente
print(best['Filename'], best['SHA256'], best['Version'])
PY
  read -r fn sum ver < deb.info
  local f
  f=$(basename "$fn")
  [ -f "$f" ] || curl -fsSL --max-time 600 -o "$f" "$1/$fn"
  echo "$sum  $f" | sha256sum -c >> "$LOG"
  say "$3 $ver: SHA-256 del .deb coincide con el indice firmado"
  echo "$f"
}
fetch_index https://apt.postgresql.org/pub/repos/apt resolute-pgdg "$DL/pgdg.gpg" pgdg
rm -rf "$B/pg17" && mkdir -p "$B/pg17"
for p in postgresql-17 postgresql-client-17 libpq5; do
  f=$(deb_get https://apt.postgresql.org/pub/repos/apt pgdg.Packages "$p" | tail -1)
  dpkg-deb -x "$f" "$B/pg17"
done

# ---------------------------------------------------------------- Bibliotecas que falten (archivo de Ubuntu)
fetch_index http://archive.ubuntu.com/ubuntu resolute /usr/share/keyrings/ubuntu-archive-keyring.gpg ubuntu
BIN=$B/pg17/usr/lib/postgresql/17/bin
LIB=$B/pg17/usr/lib/x86_64-linux-gnu
for round in 1 2 3; do
  missing=$(LD_LIBRARY_PATH=$LIB ldd "$BIN/postgres" "$BIN/psql" "$BIN/pg_dump" 2>/dev/null | awk '/not found/{print $1}' | sort -u)
  [ -z "$missing" ] && break
  for so in $missing; do
    pkg=$(python3 - ubuntu.Packages "$so" <<'PY'
import sys, re
so = sys.argv[2]
stem = re.sub(r'\.so.*', '', so)  # libicuuc -> buscar libicu<N>
want = {'libicuuc': 'libicu', 'libicui18n': 'libicu', 'libicudata': 'libicu'}.get(stem, stem)
cands = []
for block in open(sys.argv[1], encoding='utf-8', errors='replace').read().split('\n\n'):
    m = re.search(r'^Package: (\S+)', block, re.M)
    if m and re.fullmatch(re.escape(want) + r'[0-9.t]*(-[0-9]+)?', m.group(1)):
        cands.append(m.group(1))
print(sorted(cands)[-1] if cands else '')
PY
)
    [ -n "$pkg" ] || { say "sin paquete para $so"; continue; }
    f=$(deb_get http://archive.ubuntu.com/ubuntu ubuntu.Packages "$pkg" | tail -1)
    dpkg-deb -x "$f" "$B/pg17"
  done
done
say "bibliotecas no resueltas: $(LD_LIBRARY_PATH=$LIB ldd "$BIN/postgres" "$BIN/psql" "$BIN/pg_dump" 2>/dev/null | grep -c 'not found' || true)"
say "postgres: $(LD_LIBRARY_PATH=$LIB "$BIN/postgres" --version)"
say "pg_dump: $(LD_LIBRARY_PATH=$LIB "$BIN/pg_dump" --version)"
