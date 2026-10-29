import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaChevronDown } from "react-icons/fa";
import { handlePhoneNumberChange } from "../utils/phoneUtils";
import axiosInstance from "../config/axios";
import { toast } from "react-toastify";

const API_OUTSIDE_BROKER_TYPES = ["Listing Broker", "Cooperating Broker"];

const OutsideBrokersForm = ({
  outsideBrokers,
  setOutsideBrokers,
  broker,
  setBroker,
  selectedBrokerType,
  setSelectedBrokerType,
  editingBrokerIndex,
  setEditingBrokerIndex,
  showDeleteBrokerConfirm,
  handleBrokerInputChange,
  handleBrokerEdit,
  handleBrokerDelete,
  confirmDeleteBroker,
  cancelDeleteBroker,
  goToNextSection,
  goToPreviousSection,
  editingReferralGlobalIndex = null,
  onUpdateReferralAgent,
}) => {
  const MAX_OUTSIDE_BROKERS = 5;
  const isAtBrokerLimit =
    editingBrokerIndex === null && outsideBrokers.length >= MAX_OUTSIDE_BROKERS;

  // State for company dropdown
  const [companies, setCompanies] = useState([]);
  const [companySearchTerm, setCompanySearchTerm] = useState("");
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(false);

  // Debug outsideBrokers prop changes
  useEffect(() => {
    console.log(
      "OutsideBrokersForm received new outsideBrokers prop:",
      outsideBrokers
    );
  }, [outsideBrokers]);

  // Fetch companies from outside brokers database
  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    setIsLoadingCompanies(true);
    try {
      const response = await axiosInstance.get("/outside-brokers");
      // Extract unique companies from the response
      const uniqueCompanies = response.data.reduce((acc, broker) => {
        if (broker.company && !acc.find((c) => c.name === broker.company)) {
          // Construct address from new fields if available, otherwise use old address field
          let address = "";
          if (broker.streetNumber || broker.streetName || broker.city || broker.province) {
            const parts = [
              broker.streetNumber,
              broker.streetName,
              broker.unit,
              broker.city,
              broker.province
            ].filter(Boolean);
            address = parts.join(" ");
          } else {
            address = broker.address || "";
          }
          
          acc.push({
            name: broker.company,
            address: address,
            email: broker.email || "",
            phone: broker.primaryPhone || "",
          });
        }
        return acc;
      }, []);
      setCompanies(uniqueCompanies);
    } catch (error) {
      console.error("Error fetching companies:", error);
      toast.error("Failed to fetch companies");
    } finally {
      setIsLoadingCompanies(false);
    }
  };

  const handleCompanySelect = (company) => {
    setBroker((prev) => ({
      ...prev,
      company: company.name,
      email: company.email || "",
      primaryPhone: company.phone || "",
    }));
    setCompanySearchTerm(company.name);
    setShowCompanyDropdown(false);
  };

  const handleCompanyInputChange = (e) => {
    const value = e.target.value;
    setCompanySearchTerm(value);
    setBroker((prev) => ({ ...prev, company: value }));
    setShowCompanyDropdown(value.length > 0);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        showCompanyDropdown &&
        !event.target.closest(".company-dropdown-container")
      ) {
        setShowCompanyDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showCompanyDropdown]);

  // Populate form when editing a broker
  useEffect(() => {
    if (editingBrokerIndex !== null && outsideBrokers[editingBrokerIndex]) {
      const brokerToEdit = outsideBrokers[editingBrokerIndex];
      const brokerType = brokerToEdit.type || "";
      setBroker({
        type: brokerType,
        firstName: brokerToEdit.firstName || "",
        lastName: brokerToEdit.lastName || "",
        company: brokerToEdit.company || "",
        email: brokerToEdit.email || "",
        payBroker: brokerToEdit.payBroker || "No",
        end: brokerType === "Listing Broker" ? "Listing End" : "Selling End",
        primaryPhone: brokerToEdit.primaryPhone || "",
        chargedHST: brokerToEdit.chargedHST || "Yes",
        streetNumber: brokerToEdit.streetNumber || "",
        streetName: brokerToEdit.streetName || "",
        unit: brokerToEdit.unit || "",
        city: brokerToEdit.city || "",
        province: brokerToEdit.province || "",
        postalCode: brokerToEdit.postalCode || "",
      });
      setSelectedBrokerType(brokerType);
      setCompanySearchTerm(brokerToEdit.company || "");
    }
  }, [editingBrokerIndex, outsideBrokers]);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (isAtBrokerLimit) {
      toast.error(`You can add up to ${MAX_OUTSIDE_BROKERS} outside brokers.`);
      return;
    }
    const formData = {
      type: selectedBrokerType,
      firstName: broker.firstName || "",
      lastName: broker.lastName || "",
      company: broker.company || "",
      email: broker.email || "",
      payBroker: broker.payBroker || "No",
      end:
        selectedBrokerType === "Listing Broker" ? "Listing End" : "Selling End",
      primaryPhone: broker.primaryPhone || "",
      chargedHST: broker.chargedHST || "Yes",
      streetNumber: broker.streetNumber || "",
      streetName: broker.streetName || "",
      unit: broker.unit || "",
      city: broker.city || "",
      province: broker.province || "",
      postalCode: broker.postalCode || "",
    };

    console.log("OutsideBrokersForm handleFormSubmit called");
    console.log("Current outside brokers:", outsideBrokers);
    console.log("Form data:", formData);
    console.log("Editing index:", editingBrokerIndex);

    try {
      // Referral agents live on the commission list, not the OutsideBroker collection
      if (selectedBrokerType === "Referral") {
        if (
          editingReferralGlobalIndex != null &&
          typeof onUpdateReferralAgent === "function"
        ) {
          onUpdateReferralAgent(editingReferralGlobalIndex, {
            ...formData,
            unitNumber: broker.unitNumber ?? broker.unit ?? "",
          });
        } else {
          toast.error(
            "Referral details are saved with Update after choosing a referral from the commission section."
          );
          return;
        }
      } else if (!API_OUTSIDE_BROKER_TYPES.includes(selectedBrokerType)) {
        toast.error("Choose Listing Broker or Cooperating Broker to save here.");
        return;
      } else if (editingBrokerIndex !== null) {
        // Update existing broker in database
        const brokerToUpdate = outsideBrokers[editingBrokerIndex];
        if (brokerToUpdate._id) {
          await axiosInstance.put(
            `/outside-brokers/${brokerToUpdate._id}`,
            formData
          );
        }

        // Update local state
        const updatedBrokers = [...outsideBrokers];
        updatedBrokers[editingBrokerIndex] = {
          ...formData,
          _id: brokerToUpdate._id,
        };
        setOutsideBrokers(updatedBrokers);
        setEditingBrokerIndex(null);
        toast.success("Broker updated successfully");
      } else {
        // Add new broker to database
        const response = await axiosInstance.post("/outside-brokers", formData);
        const newBroker = response.data;

        // Update local state
        const newBrokers = [...outsideBrokers, newBroker];
        setOutsideBrokers(newBrokers);
        toast.success("Broker added successfully");
      }
    } catch (error) {
      console.error("Error saving broker:", error);
      const msg = error?.response?.data?.message;
      toast.error(
        typeof msg === "string" && msg ? msg : "Failed to save broker"
      );
    }

    // Reset form
    setBroker({
      type: "",
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      payBroker: "No",
      end: "Listing End",
      primaryPhone: "",
      chargedHST: "Yes",
      streetNumber: "",
      streetName: "",
      unit: "",
      city: "",
      province: "",
      postalCode: "",
    });
    setSelectedBrokerType("");
    setCompanySearchTerm("");
  };

  // Simple broker type selection handler
  const handleLocalBrokerTypeSelect = (type) => {
    setSelectedBrokerType(type);
    setBroker((prev) => ({
      ...prev,
      type: type,
      end: type === "Listing Broker" ? "Listing End" : "Selling End",
    }));
  };

  const handleAddNew = async () => {
    if (isAtBrokerLimit) {
      toast.error(`You can add up to ${MAX_OUTSIDE_BROKERS} outside brokers.`);
      return;
    }
    // First, add the current broker data to the table when a broker type is selected
    if (selectedBrokerType) {
      if (selectedBrokerType === "Referral") {
        if (
          editingReferralGlobalIndex != null &&
          typeof onUpdateReferralAgent === "function"
        ) {
          const formData = {
            ...broker,
            type: selectedBrokerType,
            end: "Selling End",
            unitNumber: broker.unitNumber ?? broker.unit ?? "",
          };
          onUpdateReferralAgent(editingReferralGlobalIndex, formData);
        } else {
          toast.error(
            "Use Update Broker to save referral changes, or pick a referral from the commission list first."
          );
        }
        return;
      }
      if (!API_OUTSIDE_BROKER_TYPES.includes(selectedBrokerType)) {
        toast.error("Choose Listing Broker or Cooperating Broker.");
        return;
      }

      const formData = {
        ...broker,
        type: selectedBrokerType,
        end:
          selectedBrokerType === "Listing Broker"
            ? "Listing End"
            : "Selling End",
      };

      try {
        // Save to database
        const response = await axiosInstance.post("/outside-brokers", formData);
        const newBroker = response.data;

        // Update local state
        setOutsideBrokers([...outsideBrokers, newBroker]);
        toast.success("Broker added successfully");
      } catch (error) {
        console.error("Error saving broker:", error);
        const msg = error?.response?.data?.message;
        toast.error(
          typeof msg === "string" && msg ? msg : "Failed to save broker"
        );
      }
    }

    // Reset form
    setEditingBrokerIndex(null);
    setSelectedBrokerType("");
    setBroker({
      type: "",
      firstName: "",
      lastName: "",
      company: "",
      email: "",
      payBroker: "No",
      end: "Listing End",
      primaryPhone: "",
      chargedHST: "Yes",
      streetNumber: "",
      streetName: "",
      unit: "",
      city: "",
      province: "",
      postalCode: "",
    });
    setCompanySearchTerm("");
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-6">Outside Brokers Information</h2>

      {outsideBrokers.length >= MAX_OUTSIDE_BROKERS && editingBrokerIndex === null && (
        <div className="mb-4 p-3 rounded border border-yellow-300 bg-yellow-50 text-yellow-800 text-sm">
          You’ve reached the limit of {MAX_OUTSIDE_BROKERS} outside brokers for
          this trade.
        </div>
      )}

      <div className="mb-6">
        <h3 className="font-medium text-gray-700 text-lg mb-2">
          Select Broker Type
        </h3>
        <div className="flex flex-wrap gap-3">
          {["Listing Broker", "Cooperating Broker"].map((type) => (
            <div key={type} className="flex items-center">
              <input
                type="radio"
                id={`broker-type-${type}`}
                name="brokerType"
                checked={selectedBrokerType === type}
                onChange={() => handleLocalBrokerTypeSelect(type)}
                className="mr-2"
              />
              <label
                htmlFor={`broker-type-${type}`}
                className="text-sm font-medium text-gray-700"
              >
                {type}
              </label>
            </div>
          ))}
        </div>
      </div>
      {selectedBrokerType && (
        <form
          onSubmit={handleFormSubmit}
          className="space-y-4 p-4 border rounded-lg"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <input
                type="text"
                name="type"
                defaultValue={selectedBrokerType}
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pay Broker
              </label>
              <select
                name="payBroker"
                value={broker.payBroker}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End
              </label>
              <input
                type="text"
                name="end"
                value={
                  selectedBrokerType === "Listing Broker"
                    ? "Listing End"
                    : "Selling End"
                }
                readOnly
                className="mt-1 block w-full rounded-md border-gray-300 bg-gray-100 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Name
              </label>
              <input
                type="text"
                name="firstName"
                value={broker.firstName || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Name
              </label>
              <input
                type="text"
                name="lastName"
                value={broker.lastName || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
          </div>
          <div className="relative company-dropdown-container">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company
            </label>
            <div className="relative">
              <input
                type="text"
                name="company"
                value={companySearchTerm || broker.company || ""}
                onChange={handleCompanyInputChange}
                onFocus={() => setShowCompanyDropdown(true)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm pr-8"
                placeholder="Type to search or enter company name"
              />
              <FaChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>

            {/* Company Dropdown */}
            {showCompanyDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                {isLoadingCompanies ? (
                  <div className="px-4 py-2 text-sm text-gray-500">
                    Loading companies...
                  </div>
                ) : companies.length === 0 ? (
                  <div className="px-4 py-2 text-sm text-gray-500">
                    No companies found
                  </div>
                ) : (
                  companies
                    .filter((company) =>
                      company.name
                        .toLowerCase()
                        .includes(companySearchTerm.toLowerCase())
                    )
                    .map((company, index) => (
                      <div
                        key={index}
                        onClick={() => handleCompanySelect(company)}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                      >
                        <div className="font-medium text-gray-900">
                          {company.name}
                        </div>
                        {company.address && (
                          <div className="text-xs text-gray-500">
                            {company.address}
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              name="email"
              value={broker.email || ""}
              onChange={handleBrokerInputChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Primary Phone Number
              </label>
              <input
                type="tel"
                name="primaryPhone"
                value={broker.primaryPhone || ""}
                onChange={(e) => handlePhoneNumberChange(e, setBroker)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Charged HST
              </label>
              <select
                name="chargedHST"
                value={broker.chargedHST}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Street Number
              </label>
              <input
                type="text"
                name="streetNumber"
                value={broker.streetNumber || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Street Name
              </label>
              <input
                type="text"
                name="streetName"
                value={broker.streetName || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit
              </label>
              <input
                type="text"
                name="unit"
                value={broker.unit || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                City
              </label>
              <input
                type="text"
                name="city"
                value={broker.city || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Province
              </label>
              <input
                type="text"
                name="province"
                value={broker.province || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Postal Code
              </label>
              <input
                type="text"
                name="postalCode"
                value={broker.postalCode || ""}
                onChange={handleBrokerInputChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-700 focus:ring-blue-700 sm:text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <button
              type="button"
              onClick={handleAddNew}
              disabled={isAtBrokerLimit}
              className="inline-flex justify-center rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
            >
              Add New
            </button>
            <button
              type="submit"
              disabled={isAtBrokerLimit}
              className="inline-flex justify-center rounded-md border border-transparent bg-yellow-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2"
            >
              {editingBrokerIndex !== null ? "Update Broker" : "Add Broker"}
            </button>
          </div>
        </form>
      )}

      {/* Outside Brokers Table */}
      {outsideBrokers.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4">Added Outside Brokers</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-4 py-2 border-b text-left">Type</th>
                  <th className="px-4 py-2 border-b text-left">First Name</th>
                  <th className="px-4 py-2 border-b text-left">Last Name</th>
                  <th className="px-4 py-2 border-b text-left">Company</th>
                  <th className="px-4 py-2 border-b text-left">End</th>
                  <th className="px-4 py-2 border-b text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {outsideBrokers.map((broker, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-2 border-b">{broker.type || "-"}</td>
                    <td className="px-4 py-2 border-b">
                      {broker.firstName || "-"}
                    </td>
                    <td className="px-4 py-2 border-b">
                      {broker.lastName || "-"}
                    </td>
                    <td className="px-4 py-2 border-b">
                      {broker.company || "-"}
                    </td>
                    <td className="px-4 py-2 border-b">{broker.end || "-"}</td>
                    <td className="px-4 py-2 border-b text-center">
                      <div className="flex justify-center space-x-2">
                        <button
                          onClick={() => handleBrokerEdit(index)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Edit"
                        >
                          <FaEdit />
                        </button>
                        <button
                          onClick={() => handleBrokerDelete(index)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteBrokerConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Confirm Delete</h3>
            <p className="mb-6">Are you sure you want to delete this broker?</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelDeleteBroker}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteBroker}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="mt-8 flex justify-between">
        <button
          type="button"
          onClick={goToPreviousSection}
          className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={goToNextSection}
          className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default OutsideBrokersForm;
