const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const router = require('./routes');

const app = new Koa();
const PORT = 9751;

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.status = err.status || 500;
    ctx.body = {
      code: err.status || 500,
      message: err.message || '服务器内部错误',
      data: null
    };
    ctx.app.emit('error', err, ctx);
  }
});

app.use(bodyParser());

app.use(router.routes());
app.use(router.allowedMethods());

app.listen(PORT, () => {
  console.log(`演出服装尺码匹配与借还核验 API 服务已启动`);
  console.log(`端口: ${PORT}`);
  console.log(`访问地址: http://localhost:${PORT}/api`);
});

module.exports = app;
