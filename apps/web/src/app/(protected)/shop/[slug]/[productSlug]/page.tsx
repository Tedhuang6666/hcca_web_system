import ShopPage from "../../page";

export default async function ThemedProductPage({
  params,
}: {
  params: Promise<{ slug: string; productSlug: string }>;
}) {
  const { slug, productSlug } = await params;
  return <ShopPage topicSlug={slug} productSlug={productSlug} />;
}
