#!/bin/bash
# PostgreSQL 17 de desarrollo de EstateForge en WSL (Ubuntu), con el usuario Linux normal (sin root).
#
#   bash scripts/wsl/postgres-dev.sh init     crea el clúster, los roles y las bases (una sola vez)
#   bash scripts/wsl/postgres-dev.sh start    arranca el servidor
#   bash scripts/wsl/postgres-dev.sh stop     lo detiene
#   bash scripts/wsl/postgres-dev.sh status   indica si está en marcha y si acepta conexiones
#
# Datos:        ${EF_PG_DATA:-~/.local/share/estateforge/pg17-dev}
# Credenciales: ~/.config/estateforge/postgres-dev.env (permisos 600, fuera del repositorio)
# Escucha solo en 127.0.0.1:${EF_PG_PORT:-55432}. El administrador solo entra por un socket local
# privado (autenticación peer); la aplicación usa un rol sin privilegios de superusuario.
#
# Binarios: los de un paquete instalado (/usr/lib/postgresql/17/bin) o los de
# scripts/wsl/instalar-herramientas.sh (~/.local/ef-tools/pg17). Nunca toca otros clústeres.
set -euo pipefail
export LC_ALL=C

DATA=${EF_PG_DATA:-$HOME/.local/share/estateforge/pg17-dev}
PORT=${EF_PG_PORT:-55432}
CONF_DIR=$HOME/.config/estateforge
CREDS=$CONF_DIR/postgres-dev.env
SOCK=$DATA/socket
TOOLS=$HOME/.local/ef-tools/pg17

if [ -x /usr/lib/postgresql/17/bin/postgres ]; then
  BIN=/usr/lib/postgresql/17/bin
elif [ -x "$TOOLS/usr/lib/postgresql/17/bin/postgres" ]; then
  BIN=$TOOLS/usr/lib/postgresql/17/bin
  export LD_LIBRARY_PATH=$TOOLS/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
else
  echo 'No se encuentra PostgreSQL 17. Ejecuta antes scripts/wsl/instalar-herramientas.sh.' >&2
  exit 1
fi

[ "$(id -u)" != 0 ] || { echo 'No ejecutes este script como root.' >&2; exit 1; }

psql_admin() { "$BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -d postgres "$@"; }
running() { "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; }

start() {
  running && { echo "PostgreSQL ya está en marcha (127.0.0.1:$PORT)."; return; }
  "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w -t 60 start >/dev/null
  echo "PostgreSQL en marcha en 127.0.0.1:$PORT."
}

case "${1:-}" in
  init)
    [ ! -e "$DATA/PG_VERSION" ] || { echo "El clúster ya existe en $DATA."; exit 1; }
    mkdir -p "$DATA" "$CONF_DIR"
    chmod 700 "$DATA" "$CONF_DIR"
    "$BIN/initdb" -D "$DATA" --auth-local=peer --auth-host=scram-sha-256 -E UTF8 --locale=C.UTF-8 >/dev/null
    mkdir -p "$SOCK" && chmod 700 "$SOCK"
    cat >> "$DATA/postgresql.conf" <<CONF
# EstateForge (desarrollo)
listen_addresses = '127.0.0.1'
port = $PORT
unix_socket_directories = '$SOCK'
unix_socket_permissions = 0700
timezone = 'UTC'
max_connections = 100
CONF
    # Solo conexiones locales: socket con peer para el administrador y TCP 127.0.0.1 con contraseña.
    printf '%s\n' 'local all all peer' 'host all all 127.0.0.1/32 scram-sha-256' > "$DATA/pg_hba.conf"
    start
    gen() { python3 -c 'import secrets; print(secrets.token_urlsafe(32))'; }
    APP_PW=$(gen); TEST_PW=$(gen); SEED_PW=$(gen)
    # Las contraseñas viajan por la entrada estándar de psql, nunca como argumentos ni en el historial.
    psql_admin <<SQL
CREATE ROLE estateforge_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 40 PASSWORD '$APP_PW';
CREATE DATABASE estateforge_dev OWNER estateforge_app ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE estateforge_shadow OWNER estateforge_app ENCODING 'UTF8' TEMPLATE template0;
REVOKE CONNECT ON DATABASE estateforge_dev, estateforge_shadow FROM PUBLIC;
GRANT CONNECT ON DATABASE estateforge_dev, estateforge_shadow TO estateforge_app;
-- Pruebas de integración: crea y destruye sus propias bases y roles temporales; no es superusuario.
CREATE ROLE estateforge_test LOGIN NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION PASSWORD '$TEST_PW';
SQL
    umask 077
    cat > "$CREDS" <<ENV
# Generado por scripts/wsl/postgres-dev.sh init. No lo copies al repositorio.
DATABASE_URL=postgresql://estateforge_app:$APP_PW@127.0.0.1:$PORT/estateforge_dev
SHADOW_DATABASE_URL=postgresql://estateforge_app:$APP_PW@127.0.0.1:$PORT/estateforge_shadow
TEST_POSTGRES_ADMIN_URL=postgresql://estateforge_test:$TEST_PW@127.0.0.1:$PORT/postgres
SEED_USER_PASSWORD=$SEED_PW
ENV
    chmod 600 "$CREDS"
    echo "Clúster creado. Credenciales en $CREDS (permisos 600)."
    ;;
  start) start ;;
  stop)
    running || { echo 'PostgreSQL no está en marcha.'; exit 0; }
    "$BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null
    echo 'PostgreSQL detenido.'
    ;;
  status)
    if running && "$BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
      echo "En marcha y aceptando conexiones en 127.0.0.1:$PORT ($("$BIN/postgres" --version))."
    else
      echo 'Detenido o sin aceptar conexiones.'
      exit 1
    fi
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac
