import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function Solicitud() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/solicitud-inquilino')
  }, [])
  return null
}
