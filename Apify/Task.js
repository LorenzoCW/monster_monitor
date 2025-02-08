async function pageFunction(context) {
  const { page, request, log } = context;

  log.info(`Processando URL: ${request.url}`);

  const siteConfigs = [
    {
      source: 'Avenida',
      urlPattern: "https://loja.supermercadosavenida.com.br/s/?q=Monster&category-2=bebidas&facets=category-2&sort=score_desc&page=0",
      priceSelector: '.new-price',
    },
    {
      source: 'Central',
      urlPattern: "https://centralmaxsupermercados.com.br/presidenteepitacio/?s=monster&post_type=product",
      priceSelector: '.price',
    },
    {
      source: 'Neto',
      urlPattern: "https://compre.superneto.com.br/loja/busca?q=monster&page=1&menor=7&maior=13&ordem=ALPHABETICAL_ASC",
      priceSelector: 'a:has(span.product-name:has-text("MONSTER")) span.price',
    },
    {
      source: 'Open',
      urlPattern: "https://pedido.anota.ai/loja/open-convenincia",
      priceSelector: 'h3.title:has-text("MONSTER") + .price .price-value',
    },
  ];

  const siteConfig = siteConfigs.find(config => request.url.includes(config.urlPattern));

  if (!siteConfig) {
    throw new Error(`Nenhum seletor definido para a URL: ${request.url}`);
  }

  await page.waitForSelector(siteConfig.priceSelector);

  const prices = await page.locator(siteConfig.priceSelector).allTextContents();

  return {
    source: siteConfig.source,
    prices,
  };
}