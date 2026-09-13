import { redirect } from 'next/navigation'

/**
 * «Avances» no es una pantalla, es un grupo. La dirección /plan escrita a
 * mano lleva al único plan que existe, el de emplasticado, en vez de a una
 * página vacía.
 */
export default async function PlanIndexPage() {
  redirect('/plan/APS')
}
