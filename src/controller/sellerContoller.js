

// upsert seller
export const upsertSeller = async (req, res) => {
  try {
    const { sellerId, name, email } = req.body;
    const updatedSeller = await Seller.findOneAndUpdate(
      { _id: sellerId },
      { name, email },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.status(200).json({
      success: true,    
        message: "Seller upserted successfully",
        data: updatedSeller,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
        message: "Error upserting seller",
        error: error.message,
    });
  } 
};
