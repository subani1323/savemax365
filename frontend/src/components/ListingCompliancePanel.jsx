import React, { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import Select from "react-select";
import axiosInstance from "../config/axios";
import ListingComplianceModal from "./ListingComplianceModal";

function listingLabel(listing) {
  const num = listing.listingNumber ?? "";
  const sn = listing.address?.streetNumber || "";
  const st = listing.address?.streetName || "";
  const addr = [sn, st].filter(Boolean).join(" ");
  return addr ? `#${num} — ${addr}` : `#${num}`;
}

const selectStyles = {
  control: (base) => ({
    ...base,
    minHeight: "38px",
    fontSize: "0.875rem",
    borderColor: "#d1d5db",
    boxShadow: "none",
    "&:hover": { borderColor: "#1d4ed8" },
  }),
  menu: (base) => ({ ...base, fontSize: "0.875rem", zIndex: 20 }),
};

const ListingCompliancePanel = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const loadListings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosInstance.get("/listings");
      const sorted = (res.data || []).sort(
        (a, b) => b.listingNumber - a.listingNumber,
      );
      setListings(sorted);
    } catch (e) {
      console.error(e);
      toast.error("Could not load listings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  const options = useMemo(
    () =>
      listings.map((l) => ({
        value: l._id,
        label: listingLabel(l),
      })),
    [listings],
  );

  const selectedOption = useMemo(
    () => options.find((o) => o.value === selectedId) || null,
    [options, selectedId],
  );

  const selectedListing = useMemo(
    () => listings.find((l) => l._id === selectedId) || null,
    [listings, selectedId],
  );

  const handleSelect = (option) => {
    const id = option?.value || "";
    setSelectedId(id);
    if (id) setModalOpen(true);
    else setModalOpen(false);
  };

  const handleSaved = (updated) => {
    if (updated?._id) {
      setListings((prev) =>
        prev.map((l) => (l._id === updated._id ? updated : l)),
      );
    } else {
      loadListings();
    }
  };

  return (
    <div className="max-w-screen-2xl mx-auto px-4">
      <h2 className="text-2xl font-bold text-blue-900 mb-2">
        Listing Compliance
      </h2>
      <p className="text-sm text-gray-600 mb-6">
        Select a listing, choose Lease or Sale, and complete the required forms
        checklist. Status updates automatically in the List view.
      </p>

      <label className="block text-sm font-medium text-gray-700 mb-1">
        Listing
      </label>
      <Select
        inputId="listing-compliance-select"
        options={options}
        value={selectedOption}
        onChange={handleSelect}
        isClearable
        isSearchable
        isDisabled={loading}
        placeholder="Search or select a listing…"
        noOptionsMessage={() => "No matching listings"}
        styles={selectStyles}
        className="mb-3 max-w-xl"
        classNamePrefix="listing-compliance"
      />

      {selectedId && !modalOpen && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 rounded-md bg-blue-900 text-white text-sm font-medium hover:bg-blue-950"
        >
          Open compliance checklist
        </button>
      )}

      {!selectedId && !loading && (
        <p className="text-sm text-gray-500">
          Choose a listing to manage compliance forms.
        </p>
      )}

      <ListingComplianceModal
        isOpen={modalOpen}
        listing={selectedListing}
        onClose={() => setModalOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
};

export default ListingCompliancePanel;
