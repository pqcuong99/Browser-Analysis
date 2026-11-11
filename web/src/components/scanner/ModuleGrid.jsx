import { motion, useReducedMotion } from 'framer-motion';
import { LayoutGrid } from 'lucide-react';
import { sortModules } from '../../lib/statusStyles.js';
import { SectionHeader } from '../common/Card.jsx';
import { ModuleCard } from './ModuleCard.jsx';

// Các thẻ hiện lần lượt: mờ → rõ, trượt nhẹ từ dưới lên
const GRID_VARIANTS = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};
const CARD_VARIANTS = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};
const CARD_VARIANTS_REDUCED = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
};

/** Lưới 10 thẻ module, tự đẩy FAIL → WARNING → PASS → UNAVAILABLE */
export function ModuleGrid({ modules, onOpen, animKey }) {
  const reduce = useReducedMotion();
  return (
    <section aria-label="10-Module Diagnostic Grid">
      <SectionHeader
        icon={LayoutGrid}
        title="10-Module Diagnostic Grid"
        hint="FAIL → WARNING → PASS → UNAVAILABLE · bấm thẻ để xem 6 thành phần bằng chứng"
      />
      {/* key đổi theo scan để hiệu ứng chạy lại sau mỗi lần quét */}
      <motion.div key={animKey} className="grid grid-cols-1 gap-6 sm:grid-cols-modules" variants={GRID_VARIANTS} initial="hidden" animate="show">
        {sortModules(modules).map((m) => (
          <motion.div key={m.module_id} variants={reduce ? CARD_VARIANTS_REDUCED : CARD_VARIANTS} className="flex">
            <ModuleCard module={m} onOpen={onOpen} />
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
