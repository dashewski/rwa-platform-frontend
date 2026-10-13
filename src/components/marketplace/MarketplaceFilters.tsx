'use client';

import React, { FC, useState } from 'react';
import clsx from 'clsx';
import { Checkbox, Radio, Icon } from '@/components/ui';
import { getCountryByCode } from '@/lib/countries';

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const FilterSection: FC<FilterSectionProps> = ({ title, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={'border-t border-blue-dim pt-6 pb-3 flex flex-col gap-6'}>
      <button
        className={'w-full flex items-center justify-between cursor-pointer'}
        onClick={() => setOpen(!open)}
      >
        <span className={'text-lg font-semibold leading-[1.4] text-black'}>{title}</span>
        <Icon
          name={'tick'}
          className={clsx('size-5 shrink-0 tr-d-all', open ? '-rotate-90' : 'rotate-90')}
        />
      </button>
      <div
        className={clsx(
          'grid tr-d-all overflow-hidden',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className={'overflow-hidden flex flex-col gap-4'}>{children}</div>
      </div>
    </div>
  );
};

interface MarketplaceFiltersProps {
  className?: string;
  sortBy?: string;
  onSortChange?: (value: string) => void;
  selectedRanges?: number[];
  onRangeChange?: (ranges: number[]) => void;
  categories?: string[];
  selectedCategories?: string[];
  onCategoryChange?: (categories: string[]) => void;
  selectedStages?: PoolStage[];
  onStageChange?: (stages: PoolStage[]) => void;
  selectedTypes?: PoolType[];
  onTypeChange?: (types: PoolType[]) => void;
  countries?: string[];
  selectedCountries?: string[];
  onCountryChange?: (countries: string[]) => void;
}

export const POOL_STAGES = [
  { value: 'upcoming',     label: 'Upcoming'      },
  { value: 'collecting',    label: 'Collecting'    },
  { value: 'paying_debt',   label: 'Paying debt'   },
  { value: 'paying_profit', label: 'Paying profit' },
] as const;

export type PoolStage = typeof POOL_STAGES[number]['value'];

export const RISK_SCORE_RANGES = [
  { label: '0 – 29',   min: 0,  max: 29  },
  { label: '30 – 49',  min: 30, max: 49  },
  { label: '50 – 69',  min: 50, max: 69  },
  { label: '70 – 89',  min: 70, max: 89  },
  { label: '90 – 100', min: 90, max: 100 },
] as const;

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price_desc', label: 'Token price: high to low' },
  { value: 'price_asc', label: 'Token price: low to high' },
  { value: 'goal_desc', label: 'Funding goal: high to low' },
  { value: 'goal_asc', label: 'Funding goal: low to high' },
] as const;

export const POOL_TYPES = [
  { value: 'fixed',    label: 'Fixed'    },
  { value: 'flexible', label: 'Flexible' },
] as const;

export type PoolType = typeof POOL_TYPES[number]['value'];

const MarketplaceFilters: FC<MarketplaceFiltersProps> = ({ className, sortBy = 'newest', onSortChange, selectedRanges = [], onRangeChange, categories = [], selectedCategories = [], onCategoryChange, selectedStages = [], onStageChange, selectedTypes = [], onTypeChange, countries = [], selectedCountries = [], onCountryChange }) => {
  return (
    <div className={clsx('flex flex-col', className)}>
      <FilterSection title={'Sort by'}>
        {SORT_OPTIONS.map(opt => (
          <Radio
            key={opt.value}
            label={opt.label}
            name={'sort-by'}
            value={opt.value}
            checked={sortBy === opt.value}
            onChange={() => onSortChange?.(opt.value)}
          />
        ))}
      </FilterSection>

      <FilterSection title={'AI risk score'}>
        {RISK_SCORE_RANGES.map((range, i) => (
          <Checkbox
            key={range.label}
            label={range.label}
            checked={selectedRanges.includes(i)}
            onChange={e => {
              const next = e.target.checked
                ? [...selectedRanges, i]
                : selectedRanges.filter(r => r !== i);
              onRangeChange?.(next);
            }}
          />
        ))}
      </FilterSection>

      <FilterSection title={'Category'}>
        {categories.length === 0 ? (
          <span className={'text-sm text-grey-dark'}>No categories available</span>
        ) : (
          categories.map(cat => (
            <Checkbox
              key={cat}
              label={cat}
              checked={selectedCategories.includes(cat)}
              onChange={e => {
                const next = e.target.checked
                  ? [...selectedCategories, cat]
                  : selectedCategories.filter(c => c !== cat);
                onCategoryChange?.(next);
              }}
            />
          ))
        )}
      </FilterSection>

      <FilterSection title={'Country'}>
        {countries.length === 0 ? (
          <span className={'text-sm text-grey-dark'}>No countries available</span>
        ) : (
          countries.map(code => (
            <Checkbox
              key={code}
              label={`${getCountryByCode(code)?.flag ?? ''} ${getCountryByCode(code)?.name ?? code}`.trim()}
              checked={selectedCountries.includes(code)}
              onChange={e => {
                const next = e.target.checked
                  ? [...selectedCountries, code]
                  : selectedCountries.filter(c => c !== code);
                onCountryChange?.(next);
              }}
            />
          ))
        )}
      </FilterSection>

      <FilterSection title={'Pool stage'}>
        {POOL_STAGES.map(stage => (
          <Checkbox
            key={stage.value}
            label={stage.label}
            checked={selectedStages.includes(stage.value)}
            onChange={e => {
              const next = e.target.checked
                ? [...selectedStages, stage.value]
                : selectedStages.filter(s => s !== stage.value);
              onStageChange?.(next);
            }}
          />
        ))}
      </FilterSection>

      <FilterSection title={'Pool type'}>
        {POOL_TYPES.map(pt => (
          <Checkbox
            key={pt.value}
            label={pt.label}
            checked={selectedTypes.includes(pt.value)}
            onChange={e => {
              const next = e.target.checked
                ? [...selectedTypes, pt.value]
                : selectedTypes.filter(t => t !== pt.value);
              onTypeChange?.(next);
            }}
          />
        ))}
      </FilterSection>
    </div>
  );
};

export default MarketplaceFilters;
