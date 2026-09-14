import React from 'react';
import { PortLocation, PortConfig } from '../../types';
import { Anchor, Truck, Check, ArrowRight } from 'lucide-react';

interface PortSelectionProps {
  selectedLocation: PortLocation | null;
  onSelectLocation: (loc: PortLocation) => void;
  ports: PortConfig[];
  onNext: () => void;
  onSelectPortKlangDirect: () => void;
}

export function PortSelection({
  selectedLocation,
  onSelectLocation,
  onNext,
  onSelectPortKlangDirect,
}: PortSelectionProps) {
  const handlePortKlangClick = () => {
    onSelectLocation('PORT_KLANG');
  };

  const handleJohorClick = () => {
    onSelectLocation('JOHOR');
  };

  return (
    <div className="max-w-[1080px] mx-auto space-y-5">
      <div className="text-center space-y-1 pt-0 sm:pt-0">
        <h2 className="text-[28px] sm:text-[32px] sm:leading-10 font-bold text-[#102a56] tracking-tight">What are you registering for?</h2>
        <p className="text-base leading-6 text-[#5b6b84]">Choose the option that matches your business.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Port Klang Card: PORT KLANG - CONVENTIONAL USER REGISTRATION */}
        <div
          onClick={handlePortKlangClick}
          className="relative rounded-lg p-5 sm:p-6 border border-[#d9e3ef] shadow-[0_2px_8px_rgba(15,23,42,0.04)] cursor-pointer bg-white flex flex-col justify-between min-h-[300px]"
        >
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="w-14 h-14 rounded-full bg-sky-50 text-[#0095e8] flex items-center justify-center shrink-0">
                <Anchor className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-[23px] sm:text-[24px] font-bold text-[#102a56] leading-tight">PORT KLANG</h3>
                <p className="text-base font-medium text-[#24477d]">Westport &amp; Northport</p>
              </div>
            </div>
            <p className="text-sm text-[#45638e] mt-2">For Forwarders &amp; Transporters</p>

            <div className="mt-4 border-t border-[#e8eef5] pt-3">
              <p className="text-xs font-semibold text-[#5b6b84] mb-2">Common examples</p>
              <div className="space-y-2 text-xs sm:text-sm text-[#5b6b84]">
                {['Transporter / trucking companies', 'Freight forwarders'].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-sky-100 text-[#0095e8] flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5" /></span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePortKlangClick();
                onSelectPortKlangDirect();
              }}
              className="w-full h-[54px] inline-flex items-center justify-center gap-2 px-4 rounded-[9px] text-base font-semibold text-white bg-[#0095e8] hover:bg-[#0078c8] transition-colors shadow-sm"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Johor Card: JOHOR DEPOT - CONTAINER AND CONVENTIONAL REGISTRATION */}
        <div
          onClick={handleJohorClick}
          className="relative rounded-lg p-5 sm:p-6 border border-[#d9e3ef] shadow-[0_2px_8px_rgba(15,23,42,0.04)] cursor-pointer bg-white flex flex-col justify-between min-h-[300px]"
        >
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="w-14 h-14 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                <Truck className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-[23px] sm:text-[24px] font-bold text-[#102a56] leading-tight">JOHOR DEPOT</h3>
                <p className="text-base font-medium text-[#24477d]">ICS &amp; INFINITY PASIR GUDANG</p>
              </div>
            </div>
            <p className="text-sm text-[#45638e] mt-2">For Container &amp; Conventional operations</p>

            <div className="mt-4 border-t border-[#e8eef5] pt-3">
              <p className="text-xs font-semibold text-[#5b6b84] mb-2">Common examples</p>
              <div className="space-y-2 text-xs sm:text-sm text-[#5b6b84]">
                {['Container handling & terminal operations', 'Conventional cargo (trucks / general goods)'].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-sky-100 text-[#0095e8] flex items-center justify-center shrink-0"><Check className="w-3.5 h-3.5" /></span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleJohorClick();
                onNext();
              }}
              className="w-full h-[54px] inline-flex items-center justify-center gap-2 px-4 rounded-[9px] text-base font-semibold text-white bg-[#0095e8] hover:bg-[#0078c8] transition-colors shadow-sm"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

