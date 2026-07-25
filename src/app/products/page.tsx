import { permanentRedirect } from 'next/navigation'
import { PRODUCTS_ROUTES } from '@/features/navigation/products-routes'

export default function ProductsPage() {
  permanentRedirect(PRODUCTS_ROUTES.dashboard)
}
