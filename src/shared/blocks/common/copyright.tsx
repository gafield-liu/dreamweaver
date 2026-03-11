'use client';

import { envConfigs } from '@/config';
import { Brand as BrandType } from '@/shared/types/blocks/common';

const COPYRIGHT_DATE = '2026-03-12';

export function Copyright({ brand }: { brand: BrandType }) {
  return (
    <div className={`text-muted-foreground text-sm`}>
      © {COPYRIGHT_DATE}{' '}
      <a
        href={brand?.url || envConfigs.app_url}
        target={brand?.target || ''}
        className="text-primary hover:text-primary/80 cursor-pointer"
      >
        {brand?.title || envConfigs.app_name}
      </a>
      , All rights reserved
    </div>
  );
}
