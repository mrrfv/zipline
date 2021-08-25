const next = require('next');
const { createServer } = require('http');
const { stat, mkdir } = require('fs/promises');
const { execSync } = require('child_process');
const { extname } = require('path');
const { red, green, bold } = require('colorette');
const { PrismaClient } = require('@prisma/client');
const validateConfig = require('./validateConfig');
const Logger = require('../src/lib/logger');
const getFile = require('./static');
const prismaRun = require('../scripts/prisma-run');
const readConfig = require('../src/lib/readConfig');
const mimes = require('../scripts/mimes');
const deployDb = require('../scripts/deploy-db');


Logger.get('server').info('starting zipline server');

const dev = process.env.NODE_ENV === 'development';

function log(url, status) {
  if (url.startsWith('/_next') || url.startsWith('/__nextjs')) return;
  return Logger.get('url').info(`${status === 200 ? bold(green(status)) : bold(red(status))}: ${url}`);
}

function shouldUseYarn() {
  try {
    execSync('yarnpkg --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  try {
    const config = readConfig();
    await validateConfig(config);

    const data = await prismaRun(config.database.url, ['migrate', 'status']);
    if (data.includes('Following migration have not yet been applied:')) {
      Logger.get('database').info('some migrations are not applied, applying them now...');
      await deployDb(config);
      Logger.get('database').info('finished applying migrations');
    }
    process.env.DATABASE_URL = config.database.url;

    await stat('./.next');
    await mkdir(config.uploader.directory, { recursive: true });

    const app = next({
      dir: '.',
      dev,
      quiet: dev
    }, config.core.port, config.core.host);

    await app.prepare();

    const handle = app.getRequestHandler();
    const prisma = new PrismaClient();
  
    const srv = createServer(async (req, res) => {
      if (req.url.startsWith(config.uploader.route)) {
        const parts = req.url.split('/');
        if (!parts[2] || parts[2] === '') return;

        const data = await getFile(config.uploader.directory, parts[2]);
        if (!data) {
          app.render404(req, res);
        } else {
          let image = await prisma.image.findFirst({
            where: {
              OR: {
                file: parts[2],
              },
              OR: {
                invisible: {
                  invis: decodeURI(parts[2])
                }
              }
            }
          });
          if (image) {
            await prisma.image.update({
              where: {
                id: image.id,
              },
              data: {
                views: {
                  increment: 1
                }
              }
            });
            res.setHeader('Content-Type', image.mimetype);
          } else {
            const mimetype = mimes[extname(parts[2])] ?? 'application/octet-stream';
            res.setHeader('Content-Type', mimetype);
          }

          res.end(data);
        }
      } else {
        handle(req, res);
      }

      log(req.url, res.statusCode);
    });

    srv.on('error', (e) => {
      Logger.get('server').error(e);

      process.exit(1);
    });
    srv.on('listening', () => {
      Logger.get('server').info(`listening on ${config.core.host}:${config.core.port}`);
    });

    srv.listen(config.core.port, config.core.host ?? '0.0.0.0');
  } catch (e) {
    if (e.message && e.message.startsWith('Could not find a production')) {
      Logger.get('web').error(`there is no production build - run \`${shouldUseYarn() ? 'yarn build' : 'npm build'}\``);
    } else if (e.code && e.code === 'ENOENT') {
      if (e.path === './.next') Logger.get('web').error(`there is no production build - run \`${shouldUseYarn() ? 'yarn build' : 'npm build'}\``);
    } else {
      Logger.get('server').error(e);
      process.exit(1);
    }
  }
})();