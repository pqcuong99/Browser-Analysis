import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Ghép class Tailwind có điều kiện và loại bỏ class xung đột (px-2 + px-4 => px-4) */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
