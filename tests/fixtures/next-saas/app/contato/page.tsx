'use client';
import { useForm } from 'react-hook-form';

export default function Contato() {
  const { register, handleSubmit } = useForm();
  return (
    <form onSubmit={handleSubmit((d) => fetch('/api/lead', { method: 'POST', body: JSON.stringify(d) }))}>
      <input {...register('nome')} name="nome" placeholder="Nome completo" />
      <input {...register('email')} type="email" name="email" />
      <input {...register('whatsapp')} type="tel" name="whatsapp" />
      <button type="submit">Quero ser contatado</button>
    </form>
  );
}
